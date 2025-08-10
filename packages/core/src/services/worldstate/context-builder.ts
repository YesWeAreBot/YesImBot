import { Bot, Channel, Context, Logger, Session } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
import { InteractionManager } from "./interaction-manager";
import { ContextualMessage, DiaryEntryData, L1HistoryItem, RetrievedMemoryChunk, WorldState } from "./types";

export class ContextBuilder {
    private logger: Logger;

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private interactionManager: InteractionManager,
        private l2Manager: SemanticMemoryManager,
        private l3Manager: ArchivalMemoryManager
    ) {
        this.logger = ctx[Services.Logger].getLogger("[数据上下文构建器]");
    }

    public async build(session: Session): Promise<WorldState> {
        const { platform, channelId, selfId, bot } = session;

        // 1. L1 - Working Memory
        let l1_working_memory = await this.interactionManager.getL1History(channelId, this.config.l1_memory.maxMessages);
        l1_working_memory = this.applyGracefulDegradation(l1_working_memory);

        // 2. L2 - Semantic Search
        const l2_retrieved_memories = await this.retrieveL2Memories(l1_working_memory);

        // 3. L3 - Diary
        const l3_diary_entries = await this.retrieveL3Memories(channelId);

        // 4. Base Info
        const channelInfo = await this.getChannelInfo(bot, channelId);
        const selfInfo = await this.getSelfInfo(session, selfId);

        const worldState: WorldState = {
            channel: {
                id: channelId,
                name: channelInfo.name,
                type: session.isDirect ? "private" : "guild",
                platform: platform,
            },
            current_time: new Date().toISOString(),
            self: selfInfo,
            l1_working_memory,
            l2_retrieved_memories,
            l3_diary_entries,
            users: [], // User profile can be another service
        };

        return worldState;
    }

    private applyGracefulDegradation(history: L1HistoryItem[]): L1HistoryItem[] {
        let agentTurnCount = 0;

        // 从后往前遍历，这样我们能先遇到最新的 agent_turn
        for (let i = history.length - 1; i >= 0; i--) {
            const item = history[i];
            if (item.type === "agent_turn") {
                agentTurnCount++;

                if (agentTurnCount > this.config.l1_memory.keepFullTurnCount) {
                    // 从 history 中移除整个 turn
                    history.splice(i, 1);
                }
                // 在 keepFullTurnCount 阈值内的 turn 保持不变
            }
        }
        return history;
    }

    private async retrieveL2Memories(history: L1HistoryItem[]): Promise<RetrievedMemoryChunk[]> {
        if (!this.config.l2_memory.enabled) return [];

        const lastUserMessage = history.filter((item) => item.type === "message" && item.sender.id !== this.ctx.bots[0]?.selfId).pop() as {
            type: "message";
        } & ContextualMessage;

        if (!lastUserMessage) return [];

        const retrieved = await this.l2Manager.search(lastUserMessage.content, this.config.l2_memory.retrievalK);
        return retrieved.map((chunk) => ({
            content: chunk.content,
            relevance: chunk.similarity,
            timestamp: chunk.startTimestamp,
        }));
    }

    private async retrieveL3Memories(channelId: string): Promise<DiaryEntryData[]> {
        if (!this.config.l3_memory.enabled) return [];
        // Example: retrieve yesterday's diary
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split("T")[0];
        return this.ctx.database.get("worldstate.l3_diaries", { channelId, date: dateStr });
    }

    private async getChannelInfo(bot: Bot, channelId: string) {
        try {
            return await bot.getChannel(channelId);
        } catch (error) {
            this.logger.debug(`获取频道信息失败 for channel ${channelId}: ${error.message}`);
            return { id: channelId, name: "未知频道" };
        }
    }

    private async getSelfInfo(session: Session, selfId: string) {
        try {
            const user = await session.bot.getUser(selfId);
            return { id: selfId, name: user.name };
        } catch (error) {
            this.logger.debug(`获取机器人自身信息失败 for id ${selfId}: ${error.message}`);
            return { id: selfId, name: session.bot.user.name || "Self" };
        }
    }
}
