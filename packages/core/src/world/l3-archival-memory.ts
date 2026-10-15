import { randomUUID } from "node:crypto";

import { $, Context, Logger } from "koishi";

import type { LoggerService } from "../logger";
import { IChatModel, ModelService, TaskType } from "../model";
import { withUsageScope } from "../model/usage";
import { TableName } from "../shared/constants";
import { HistoryConfig } from "./config";
import { InteractionManager } from "./interaction-manager";
import { MemoryTarget, SemanticMemoryManager } from "./l2-semantic-memory";
import { diaryDateKey, diaryDayRange } from "./memory-date";
import { AgentLogEntry, DiaryEntryData, MessageData } from "./types";

export class ArchivalMemoryManager {
    private logger: Logger;
    private chatModel: IChatModel | null = null;
    private dailyTaskTimer?: NodeJS.Timeout;
    private stopped = false;
    private lifecycle = 0;
    private pendingDiaries = new Map<string, Promise<DiaryEntryData | undefined>>();
    private pendingWrites = new Set<Promise<unknown>>();
    private controllers = new Set<AbortController>();
    private thresholdChecks = new Map<string, { dirty: boolean; done: Promise<void> }>();

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private interactionManager: InteractionManager,
        logging: LoggerService,
        private readonly model: ModelService,
        private semanticMemory?: SemanticMemoryManager,
    ) {
        this.logger = logging.getLogger("[L3-长期记忆]");
    }

    public start() {
        this.lifecycle++;
        this.stopped = false;
        if (this.dailyTaskTimer) clearTimeout(this.dailyTaskTimer);
        if (!this.config.l3_memory.enabled) return;

        try {
            this.chatModel = this.model.useChatGroup(TaskType.Chat)?.getModels()[0] ?? null;
        } catch {
            this.chatModel = null;
        }
        if (!this.chatModel) {
            this.logger.warn("未找到任何可用的聊天模型，L3 日记功能将无法工作");
            return;
        }

        if (this.config.l3_memory.scheduled !== false) this.scheduleDailyTask();
        this.logger.info("L3 日记服务已启动");
    }

    public async stop(): Promise<void> {
        this.stopped = true;
        this.lifecycle++;
        for (const controller of this.controllers) controller.abort();
        if (this.dailyTaskTimer) {
            clearTimeout(this.dailyTaskTimer);
        }
        await Promise.allSettled(this.pendingWrites);
    }

    public async generateOnDemand(platform: string, channelId: string, date = new Date()) {
        if (this.stopped || !this.config.l3_memory.enabled) throw new Error("L3 日记未启用");
        if (!this.chatModel) throw new Error("L3 没有可用的聊天模型");
        const lifecycle = this.lifecycle;
        const result = await this.generateDiaryForChannel(platform, channelId, date, undefined, true);
        if (this.stopped || this.lifecycle !== lifecycle) throw new Error("日记任务已取消");
        return result;
    }

    public async observeMessage(message: MessageData) {
        const threshold = this.config.l3_memory.messageThreshold ?? 0;
        if (!threshold || this.stopped || !this.config.l3_memory.enabled || !this.chatModel) return;
        const date = new Date(message.timestamp);
        const generation = this.semanticMemory?.getHistoryGeneration(message);
        const lifecycle = this.lifecycle;
        const key = JSON.stringify([message.platform, message.channelId, diaryDateKey(date), generation, lifecycle]);
        const pending = this.thresholdChecks.get(key);
        if (pending) {
            pending.dirty = true;
            return pending.done;
        }
        const check = { dirty: true, done: Promise.resolve() };
        this.thresholdChecks.set(key, check);
        check.done = this.checkMessageThreshold(message, date, threshold, generation, lifecycle, check, key);
        return check.done;
    }

    private async checkMessageThreshold(
        message: MessageData,
        date: Date,
        threshold: number,
        generation: number | undefined,
        lifecycle: number,
        check: { dirty: boolean },
        key: string,
    ) {
        const { start, end } = diaryDayRange(date);
        const active = () =>
            !this.stopped && this.lifecycle === lifecycle && (!this.semanticMemory || this.semanticMemory.getHistoryGeneration(message) === generation);
        try {
            while (check.dirty && active()) {
                check.dirty = false;
                const target = { platform: message.platform, channelId: message.channelId };
                const [messageCount, previousCount] = await Promise.all([
                    this.ctx.database.eval(TableName.Messages, (row) => $.count(row.id), { ...target, timestamp: { $gte: start, $lt: end } }),
                    this.ctx.database.eval(TableName.L3Diaries, (row) => $.max(row.sourceMessageCount), { ...target, date: diaryDateKey(date) }),
                ]);
                if (!active()) return;
                if (messageCount < 5 || messageCount - (previousCount ?? 0) < threshold) continue;
                const generated = await this.generateDiaryForChannel(message.platform, message.channelId, date, undefined, true);
                if (generated) check.dirty = true;
            }
        } finally {
            if (this.thresholdChecks.get(key) === check) this.thresholdChecks.delete(key);
        }
    }

    private scheduleDailyTask() {
        if (this.stopped) return;
        const time = this.config.l3_memory.diaryGenerationTime;
        if (!/^\d{2}:\d{2}$/.test(time)) {
            this.logger.warn("日记生成时间必须是有效的 HH:mm 格式");
            return;
        }
        const now = new Date();
        const [hour, minute] = time.split(":").map(Number);
        if (hour > 23 || minute > 59) {
            this.logger.warn("日记生成时间必须是有效的 HH:mm 格式");
            return;
        }

        let nextRun = new Date();
        nextRun.setHours(hour, minute, 0, 0);

        if (now >= nextRun) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        const delay = nextRun.getTime() - now.getTime();
        const lifecycle = this.lifecycle;
        this.dailyTaskTimer = setTimeout(() => {
            if (this.stopped || this.lifecycle !== lifecycle) return;
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);
            void this.generateDiariesForAllChannels(yesterday, true)
                .catch((error) => this.logger.error("每日日记生成任务失败", error))
                .finally(() => {
                    if (!this.stopped && this.lifecycle === lifecycle) this.scheduleDailyTask();
                });
        }, delay);

        this.logger.info(`下一次日记生成任务将在 ${nextRun.toLocaleString()} 执行`);
    }

    public async generateDiariesForAllChannels(date = new Date(), incremental = false) {
        if (this.stopped || !this.config.l3_memory.enabled || !this.chatModel) return;
        const lifecycle = this.lifecycle;
        const diaryDate = new Date(date);
        this.logger.info("开始执行每日日记生成任务...");
        const messageChannels = await this.ctx.database.get(TableName.Messages, {}, { fields: ["platform", "channelId"] });

        const knownChannels = [...new Map(messageChannels.map((channel) => [JSON.stringify([channel.platform, channel.channelId]), channel])).values()];
        const agentChannels = await this.interactionManager.getAgentChannels(knownChannels);

        const allChannels = [...messageChannels, ...agentChannels];
        const uniqueChannels = [...new Map(allChannels.map((channel) => [JSON.stringify([channel.platform, channel.channelId]), channel])).values()];

        for (const channel of uniqueChannels) {
            if (this.stopped || this.lifecycle !== lifecycle) return;
            try {
                await this.generateDiaryForChannel(channel.platform, channel.channelId, diaryDate, uniqueChannels, incremental);
            } catch (error) {
                this.logger.warn(`频道 ${channel.platform}:${channel.channelId} 日记生成失败，继续处理其他频道：${String(error)}`);
            }
        }
        this.logger.info("每日日记生成任务完成。");
    }

    public generateDiaryForChannel(
        platform: string,
        channelId: string,
        date: Date,
        knownChannels?: MemoryTarget[],
        incremental = false,
    ): Promise<DiaryEntryData | undefined> {
        if (this.stopped || !this.config.l3_memory.enabled || !this.chatModel) return Promise.resolve(undefined);
        const target = { platform, channelId };
        const generation = this.semanticMemory?.getHistoryGeneration(target);
        const lifecycle = this.lifecycle;
        const diaryDate = new Date(date);
        const key = JSON.stringify([platform, channelId, diaryDateKey(diaryDate), lifecycle, generation, incremental]);
        const existing = this.pendingDiaries.get(key);
        if (existing) return existing;
        const task = this.generateDiary(target, diaryDate, lifecycle, generation, knownChannels, incremental);
        this.pendingDiaries.set(key, task);
        const finish = () => {
            if (this.pendingDiaries.get(key) === task) this.pendingDiaries.delete(key);
        };
        void task.then(finish, finish);
        return task;
    }

    private async generateDiary(
        target: MemoryTarget,
        date: Date,
        lifecycle: number,
        generation?: number,
        knownChannels?: MemoryTarget[],
        incremental = false,
    ): Promise<DiaryEntryData | undefined> {
        const { platform, channelId } = target;
        const dateKey = diaryDateKey(date);
        const active = () =>
            !this.stopped && this.lifecycle === lifecycle && (!this.semanticMemory || this.semanticMemory.getHistoryGeneration(target) === generation);
        const controller = new AbortController();
        this.controllers.add(controller);
        try {
            await this.semanticMemory?.waitForHistoryClear(target);
            if (!active()) return;
            const existing = await this.ctx.database.get(TableName.L3Diaries, { platform, channelId, date: dateKey });
            if ((!incremental && existing.length) || !active()) return;
            const channels = knownChannels ?? (await this.ctx.database.get(TableName.Messages, {}, { fields: ["platform", "channelId"] }));
            if (!active()) return;
            const { start: startOfDay, end: endOfDay } = diaryDayRange(date);
            const [messages, agentLogs] = await Promise.all([
                this.ctx.database.get(TableName.Messages, {
                    platform,
                    channelId,
                    timestamp: { $gte: startOfDay, $lt: endOfDay },
                }),
                this.interactionManager.getAgentHistoryForDateRange(platform, channelId, startOfDay, endOfDay, channels),
            ]);
            if (!active()) return;

            if (messages.length + agentLogs.length < 5) return;
            if (incremental && existing.some((d) => (d.sourceMessageCount ?? -1) >= messages.length)) return;

            const conversationText = this.formatInteractionsForPrompt(messages, agentLogs);
            const prompt = this.buildDiaryPrompt(conversationText);

            const diaryContent = await withUsageScope({ platform, target: channelId, purpose: "L3日记摘要" }, () =>
                this.chatModel!.chat({
                    requestPurpose: "L3 日记总结",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.2,
                    abortSignal: controller.signal,
                }),
            );
            if (!active()) return;
            const diaryEntry: DiaryEntryData = {
                id: `diary_${platform}_${channelId}_${dateKey}${incremental ? `_${randomUUID()}` : ""}`,
                generatedAt: new Date(),
                sourceMessageCount: messages.length,
                date: dateKey,
                platform,
                channelId,
                content: diaryContent.text ?? "",
                keywords: [], // Keyword extraction can be a separate step
                mentionedUserIds: [...new Set(messages.map((m) => m.sender.id))],
            };
            const write = () => {
                if (!active()) throw new Error("日记任务已取消");
                const writing = this.ctx.database.create(TableName.L3Diaries, diaryEntry);
                this.pendingWrites.add(writing);
                void writing.finally(() => this.pendingWrites.delete(writing)).catch(() => {});
                return writing;
            };
            const saved =
                this.semanticMemory && generation !== undefined
                    ? await this.semanticMemory.writeMemory(target, generation, write)
                    : await write().then(() => true);
            if (saved) {
                this.logger.debug(`为频道 ${platform}:${channelId} 生成了 ${dateKey} 的日记`);
                return diaryEntry;
            }
        } catch (error) {
            if (active()) {
                this.logger.error(`为频道 ${platform}:${channelId} 生成日记失败`, error);
                if (incremental) throw error;
            }
        } finally {
            this.controllers.delete(controller);
        }
    }

    private buildDiaryPrompt(conversation: string): string {
        // This should be a more sophisticated prompt, possibly loaded from a file.
        return `
You are an AI assistant writing your personal diary.
Based on the following conversation log from today, write a short, first-person diary entry.
Reflect on the key events, interesting discussions, and your own "feelings" or "thoughts" about them.
Do not just summarize. Create a narrative.

Conversation Log:
---
${conversation}
---

My Diary Entry for Today:
        `.trim();
    }

    private formatInteractionsForPrompt(messages: any[], agentLogs: AgentLogEntry[]): string {
        const combined = [
            ...messages.map((m) => ({ ...m, type: "message", timestamp: new Date(m.timestamp) })),
            ...agentLogs.map((l) => ({ ...l, timestamp: new Date(l.timestamp) })),
        ];

        combined.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return combined
            .map((item) => {
                switch (item.type) {
                    case "message":
                        return `[${item.sender.name || "Unknown"}]: ${item.content}`;
                    case "agent_thought":
                        return `(Self, thoughts): Observe: ${item.thoughts.observe}, Analyze: ${item.thoughts.analyze_infer}, Plan: ${item.thoughts.plan}`;
                    case "agent_action":
                        return `(Self, action): Execute ${item.function} with params ${JSON.stringify(item.params)}`;
                    case "agent_observation":
                        return `(Self, observation): Result of ${item.function} was ${item.status}`;
                    default:
                        return "";
                }
            })
            .filter(Boolean)
            .join("\n");
    }
}
