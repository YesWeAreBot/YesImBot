import { Dirent } from "fs";
import fs from "fs/promises";
import { Context, Logger } from "koishi";
import path from "path";

import { IChatModel } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { InteractionManager } from "./interaction-manager";
import { AgentLogEntry, DiaryEntryData } from "./types";

export class ArchivalMemoryManager {
    private chatModel: IChatModel;
    private dailyTaskTimer: NodeJS.Timeout;

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private interactionManager: InteractionManager
    ) {}

    public start() {
        if (!this.config.l3_memory.enabled) return;

        try {
            this.chatModel = this.ctx[Services.Model].getChatModel(this.config.l3_memory.useModel);
        } catch {
            this.chatModel = null;
        }
        if (!this.chatModel) {
            this.ctx.logger.warn("未找到任何可用的聊天模型，L3 日记功能将无法工作");
            return;
        }

        this.scheduleDailyTask();
        this.ctx.logger.info("L3 日记服务已启动");
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
            void this.generateDiariesForAllChannels().catch((error) => {
                this.ctx.logger.error("每日日记生成任务执行失败", error);
            });
            this.scheduleDailyTask(); // Schedule for the next day
        }, delay);

        this.ctx.logger.info(`下一次日记生成任务将在 ${nextRun.toLocaleString()} 执行`);
    }

    public async generateDiariesForAllChannels() {
        this.ctx.logger.info("开始执行每日日记生成任务...");
        const messageChannels = await this.ctx.database.get(TableName.Messages, {}, { fields: ["platform", "channelId"] });

        let agentLogDirs: Dirent[] = [];
        try {
            agentLogDirs = (await fs.readdir(path.join(this.ctx.baseDir, "data", "yesimbot", "interactions"), {
                withFileTypes: true,
            })) as unknown as Dirent[];
        } catch (err: any) {
            if (err?.code !== "ENOENT") throw err;
        }

        const agentChannels = (
            await Promise.all(
                agentLogDirs
                    .filter((dirent) => dirent.isDirectory())
                    .map(async (platformDir) => {
                        const files = await fs.readdir(path.join(this.ctx.baseDir, "data", "yesimbot", "interactions", platformDir.name));
                        return files.map((file) => ({
                            platform: platformDir.name,
                            channelId: path.basename(file, ".agent.jsonl"),
                        }));
                    })
            )
        ).flat();

        const allChannels = [...messageChannels, ...agentChannels];
        const uniqueChannels = [...new Set(allChannels.map((c) => `${c.platform}:${c.channelId}`))];

        for (const channel of uniqueChannels) {
            const [platform, ...channelIdParts] = channel.split(":");
            const channelId = channelIdParts.join(":");
            await this.generateDiaryForChannel(platform, channelId, new Date());
        }
        this.ctx.logger.info("每日日记生成任务完成。");
    }

    public async generateDiaryForChannel(platform: string, channelId: string, date: Date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const [messages, agentLogs] = await Promise.all([
            this.ctx.database.get(TableName.Messages, {
                platform,
                channelId,
                timestamp: { $gte: startOfDay, $lt: endOfDay },
            }),
            this.interactionManager.getAgentHistoryForDateRange(platform, channelId, startOfDay, endOfDay),
        ]);

        if (messages.length + agentLogs.length < 5) return; // Don't generate diary for too few interactions

        const conversationText = this.formatInteractionsForPrompt(messages, agentLogs);
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
            await this.ctx.database.create(TableName.L3Diaries, diaryEntry);
            this.ctx.logger.debug(`为频道 ${platform}:${channelId} 生成了 ${date.toISOString().split("T")[0]} 的日记`);
        } catch (error: any) {
            this.ctx.logger.error(`为频道 ${platform}:${channelId} 生成日记失败`, error);
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
