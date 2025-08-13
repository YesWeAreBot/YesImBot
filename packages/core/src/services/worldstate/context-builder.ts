import { Bot, Context, is, Logger, Session } from "koishi";

import { Services } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { InteractionManager } from "./interaction-manager";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
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
        const { platform, channelId, isDirect } = session;

        // 1. L1 - Working Memory
        const raw_l1_history = await this.interactionManager.getL1History(platform, channelId, this.config.l1_memory.maxMessages);

        // Determine if L1 is overloaded before degradation
        const isL1Overloaded = raw_l1_history.length >= this.config.l1_memory.maxMessages * 0.8;

        const l1_history = this.applyGracefulDegradation(raw_l1_history);

        // 2. Partition L1 History
        const { processed_events, new_events } = this.partitionL1History(session.selfId, l1_history);

        // 3. L2 - Semantic Search (only if L1 is overloaded)
        let l2_retrieved_memories = [];
        if (isL1Overloaded) {
            const earliestMessageTimestamp = raw_l1_history
                .filter((e) => e.type === "message")
                .map((e) => e.timestamp)
                .reduce((earliest, current) => (current < earliest ? current : earliest), new Date());

            l2_retrieved_memories = await this.retrieveL2Memories(new_events, {
                platform,
                channelId,
                k: this.config.l2_memory.retrievalK,
                earliestMessageTimestamp,
            });
        } else {
            l2_retrieved_memories = [];
        }

        // 4. L3 - Diary
        const l3_diary_entries = await this.retrieveL3Memories(channelId);

        // 4. Base Info
        const channelInfo = await this.getChannelInfo(session);
        const selfInfo = await this.getSelfInfo(session);

        const users = [];

        if (isDirect) {
            users.push({
                id: session.userId,
                name: session.author.name,
            });
            users.push({
                id: session.selfId,
                name: selfInfo.name,
                roles: ["self"],
            });
        } else {
            let selfInGuild: Awaited<ReturnType<Bot["getGuildMember"]>>;
            try {
                selfInGuild = await session.bot.getGuildMember(channelId, session.selfId);
            } catch (error) {
                this.logger.error(`获取机器人自身信息失败 for id ${session.selfId}: ${error.message}`);
            }

            users.push({
                id: session.selfId,
                name: selfInGuild?.nick || selfInGuild?.name || selfInfo.name,
                roles: ["self", ...selfInGuild?.roles],
                description: "",
            });

            l1_history.forEach((item) => {
                if (item.type === "message") {
                    if (!users.find((u) => u.id === item.sender.id)) {
                        users.push({
                            id: item.sender.id,
                            name: item.sender.name,
                            roles: item.sender.roles,
                        });
                    }
                }
            });
        }

        const worldState: WorldState = {
            channel: {
                id: channelId,
                name: channelInfo.name,
                type: session.isDirect ? "private" : "guild",
                platform: platform,
            },
            current_time: new Date().toISOString(),
            self: selfInfo,
            l1_working_memory: { processed_events, new_events },
            l2_retrieved_memories,
            l3_diary_entries,
            users: users, // User profile can be another service
        };

        return worldState;
    }

    /**
     * 裁剪过期的智能体响应
     * @param history
     * @returns
     */
    private applyGracefulDegradation(history: L1HistoryItem[]): L1HistoryItem[] {
        const turnIdsToKeep = new Set<string>();
        const turnIdsToDrop = new Set<string>();

        // 从后往前遍历，找到超出保留数量的思考事件，并记录它们的 turnId
        for (let i = history.length - 1; i >= 0; i--) {
            const item = history[i];
            if (item.type === "agent_thought" || item.type === "agent_action" || item.type === "agent_observation") {
                if (turnIdsToKeep.size < this.config.l1_memory.keepFullTurnCount) {
                    turnIdsToKeep.add(item.turnId);
                } else {
                    if (!turnIdsToKeep.has(item.turnId)) {
                        turnIdsToDrop.add(item.turnId);
                    }
                }
            }
        }

        if (turnIdsToDrop.size === 0) {
            return history;
        }

        // 返回一个新数组，其中不包含属于要删除的 turnId 的所有事件
        return history.filter((item) => {
            if (item.type === "agent_thought" || item.type === "agent_action" || item.type === "agent_observation") {
                const turnId = item.turnId;
                return !turnIdsToDrop.has(turnId);
            }
            return true; // 保留所有非 agent 事件
        });
    }

    private async retrieveL2Memories(
        new_events: L1HistoryItem[],
        filter?: { platform?: string; channelId?: string; k?: number; earliestMessageTimestamp?: Date }
    ): Promise<RetrievedMemoryChunk[]> {
        if (!this.config.l2_memory.enabled || new_events.length === 0) return [];

        const queryMessages = new_events.filter((e): e is { type: "message" } & ContextualMessage => e.type === "message");

        if (queryMessages.length === 0) return [];

        const queryText = this.l2Manager.compileEventsToText(queryMessages);

        if (!queryText) return [];

        const retrieved = await this.l2Manager.search(queryText, {
            platform: filter?.platform,
            channelId: filter?.channelId,
            k: this.config.l2_memory.retrievalK,
            earliestMessageTimestamp: filter?.earliestMessageTimestamp,
        });
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

    private async getChannelInfo(session: Session) {
        const { isDirect, channelId } = session;
        let channelInfo: Awaited<ReturnType<Bot["getChannel"]>>;
        let channelName = "";

        if (isDirect) {
            let userInfo: Awaited<ReturnType<Bot["getUser"]>>;
            try {
                userInfo = await session.bot.getUser(session.userId);
            } catch (error) {
                this.logger.debug(`获取用户信息失败 for user ${session.userId}: ${error.message}`);
            }

            channelName = `与 ${userInfo?.name || session.userId} 的私聊`;
        } else {
            try {
                channelInfo = await session.bot.getChannel(channelId);
                channelName = channelInfo.name;
            } catch (error) {
                this.logger.debug(`获取频道信息失败 for channel ${channelId}: ${error.message}`);
            }
            channelName = channelInfo?.name || "未知群组";
        }

        return { id: channelId, name: channelName };
    }

    private async getSelfInfo(session: Session) {
        const { selfId } = session;
        try {
            const user = await session.bot.getUser(selfId);
            return { id: selfId, name: user.name };
        } catch (error) {
            this.logger.debug(`获取机器人自身信息失败 for id ${selfId}: ${error.message}`);
            return { id: selfId, name: session.bot.user.name || "Self" };
        }
    }

    private partitionL1History(selfId: string, history: L1HistoryItem[]) {
        const processed_events: L1HistoryItem[] = [];
        const new_events: L1HistoryItem[] = [];

        const lastAgentTurnTime = history
            .filter((item) => item.type === "agent_thought" || item.type === "agent_action")
            .map((item) => item.timestamp)
            .reduce((latest, current) => (current > latest ? current : latest), new Date(0));

        history.forEach((item) => {
            // 基于时间戳判断是否是新的
            // 如果 item 是一个消息，则它需要发送者不是机器人自身才算“新”
            // 如果 item 不是消息，则这个条件始终为 true，也就是说只要时间戳满足，非消息类型就总是“新”的
            item.is_new = item.timestamp > lastAgentTurnTime && (item.type === "message" ? item.sender.id !== selfId : true);

            (item as any).is_message = item.type === "message";
            (item as any).is_agent_thought = item.type === "agent_thought";
            (item as any).is_agent_action = item.type === "agent_action";
            (item as any).is_agent_observation = item.type === "agent_observation";
            (item as any).is_system_event = item.type === "system_event";
        });

        const firstNewIndex = history.findIndex((item) => item.is_new);

        if (firstNewIndex === -1) {
            processed_events.push(...history);
        } else {
            processed_events.push(...history.slice(0, firstNewIndex));
            new_events.push(...history.slice(firstNewIndex));
        }
        return { processed_events, new_events };
    }
}
