import { Context, Logger, Service } from "koishi";
import { IChatModel, TaskType } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { DiaryEntryData, InteractionData, MessageData } from "./types";

export class ArchivalMemoryManager {
    private ctx: Context;
    private config: HistoryConfig;

    private logger: Logger;
    private chatModel: IChatModel;
    private dailyTaskTimer: NodeJS.Timeout;

    constructor(ctx: Context, config: HistoryConfig) {
        this.ctx = ctx;
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[L3-长期记忆]");
    }

    public start() {
        if (!this.config.l3_memory.enabled) return;

        try {
            this.chatModel = this.ctx[Services.Model].useChatGroup(TaskType.Chat).getModels()[0];
        } catch {
            this.chatModel = null;
        }
        if (!this.chatModel) {
            this.logger.warn("未找到任何可用的聊天模型，L3 日记功能将无法工作");
            return;
        }

        this.scheduleDailyTask();
        this.logger.info("L3 日记服务已启动");
    }

    public stop() {
        if (this.dailyTaskTimer) {
            clearTimeout(this.dailyTaskTimer);
        }
    }

    private scheduleDailyTask() {
        const now = new Date();
        const [hour, minute] = this.config.l3_memory.diaryGenerationTime.split(":").map(Number);

        let nextRun = new Date();
        nextRun.setHours(hour, minute, 0, 0);

        if (now > nextRun) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        const delay = nextRun.getTime() - now.getTime();
        this.dailyTaskTimer = setTimeout(() => {
            this.generateDiariesForAllChannels();
            this.scheduleDailyTask(); // Schedule for the next day
        }, delay);

        this.logger.info(`下一次日记生成任务将在 ${nextRun.toLocaleString()} 执行`);
    }

    public async generateDiariesForAllChannels() {
        this.logger.info("开始执行每日日记生成任务...");
        const channels = await this.ctx.database.get(TableName.Interactions, {}, { fields: ["platform", "channelId"] });
        const uniqueChannels = [...new Set(channels.map((c) => `${c.platform}:${c.channelId}`))];

        for (const channel of uniqueChannels) {
            const [platform, channelId] = channel.split(":");
            await this.generateDiaryForChannel(platform, channelId, new Date());
        }
        this.logger.info("每日日记生成任务完成。");
    }

    public async generateDiaryForChannel(platform: string, channelId: string, date: Date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const interactions = await this.ctx.database.get(TableName.Interactions, {
            platform,
            channelId,
            startTimestamp: { $gte: startOfDay, $lt: endOfDay },
        });

        if (interactions.length === 0) return;

        const interactionIds = interactions.map((i) => i.id);
        const messages = await this.ctx.database.get(TableName.Messages, { interactionId: { $in: interactionIds } });

        if (messages.length < 5) return; // Don't generate diary for too few messages

        const conversationText = messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
        const prompt = this.buildDiaryPrompt(conversationText);

        try {
            const diaryContent = await this.chatModel.chat({
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2,
            });
            const diaryEntry: DiaryEntryData = {
                id: `diary_${platform}_${channelId}_${date.toISOString().split("T")[0]}`,
                date: date.toISOString().split("T")[0],
                platform,
                channelId,
                content: diaryContent.text,
                keywords: [], // Keyword extraction can be a separate step
                mentionedUserIds: [...new Set(messages.map((m) => m.sender.id))],
            };
            await this.ctx.database.create("worldstate.l3_diaries", diaryEntry);
            this.logger.debug(`为频道 ${platform}:${channelId} 生成了 ${date.toISOString().split("T")[0]} 的日记`);
        } catch (error) {
            this.logger.error(`为频道 ${platform}:${channelId} 生成日记失败`, error);
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
}
