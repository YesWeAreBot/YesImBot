import { Bot, Context, Logger, Session } from "koishi";

import { Config } from "@/config";
import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import { InteractionManager } from "./interaction-manager";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
import {
    ContextualMessage,
    DiaryEntryData,
    L1HistoryItem,
    RetrievedMemoryChunk,
    WorldState,
    AnyAgentStimulus,
    UserMessageStimulus,
    SystemEventStimulus,
    ScheduledTaskStimulus,
    BackgroundTaskCompletionStimulus,
    StimulusSource,
} from "./types";

export class ContextBuilder {
    constructor(
        private ctx: Context,
        private config: Config,
        private interactionManager: InteractionManager,
        private l2Manager: SemanticMemoryManager,
        private l3Manager: ArchivalMemoryManager
    ) {}

    /**
     * 根据刺激类型构建世界状态
     */
    public async buildFromStimulus(stimulus: AnyAgentStimulus): Promise<WorldState> {
        switch (stimulus.type) {
            case StimulusSource.UserMessage:
                return this.buildFromUserMessage(stimulus as UserMessageStimulus);
            case StimulusSource.SystemEvent:
                return this.buildFromSystemEvent(stimulus as SystemEventStimulus);
            case StimulusSource.ScheduledTask:
                return this.buildFromScheduledTask(stimulus as ScheduledTaskStimulus);
            case StimulusSource.BackgroundTaskCompletion:
                return this.buildFromBackgroundTask(stimulus as BackgroundTaskCompletionStimulus);
            default:
                const _exhaustive: never = stimulus;
                throw new Error(`Unsupported stimulus type: ${(stimulus as any).type}`);
        }
    }

    /**
     * 从用户消息刺激构建世界状态
     */
    private async buildFromUserMessage(stimulus: UserMessageStimulus): Promise<WorldState> {
        const session = stimulus.payload.session;
        const { platform, channelId } = session;

        const baseWorldState = await this.buildBaseWorldState(platform, channelId, session);

        return {
            ...baseWorldState,
            triggerContext: {
                type: "user_message",
                sender: session.author,
            },
        };
    }

    /**
     * 从系统事件刺激构建世界状态
     */
    private async buildFromSystemEvent(stimulus: SystemEventStimulus): Promise<WorldState> {
        const session = stimulus.payload.session;
        const { platform, channelId } = session;

        const baseWorldState = await this.buildBaseWorldState(platform, channelId, session);

        return {
            ...baseWorldState,
            triggerContext: {
                type: "system_event",
                eventType: stimulus.payload.eventType,
                message: stimulus.payload.message,
                details: stimulus.payload.details,
            },
        };
    }

    /**
     * 从定时任务刺激构建世界状态
     */
    private async buildFromScheduledTask(stimulus: ScheduledTaskStimulus): Promise<WorldState> {
        const { platform, channelId } = stimulus.payload;

        // 对于定时任务，没有真实的 session，需要创建一个虚拟的上下文
        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) {
            throw new Error(
                `No bot found for platform: ${platform}, available platforms: ${this.ctx.bots.map((b) => b.platform).join(", ")}`
            );
        }

        const baseWorldState = await this.buildBaseWorldStateWithoutSession(platform, channelId, bot);

        return {
            ...baseWorldState,
            triggerContext: {
                type: "scheduled_task",
                taskId: stimulus.payload.taskId,
                taskType: stimulus.payload.taskType,
                scheduledTime: stimulus.payload.scheduledTime,
                params: stimulus.payload.params,
            },
        };
    }

    /**
     * 从后台任务完成刺激构建世界状态
     */
    private async buildFromBackgroundTask(stimulus: BackgroundTaskCompletionStimulus): Promise<WorldState> {
        const { platform, channelId } = stimulus.payload;

        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) {
            throw new Error(`No bot found for platform: ${platform}`);
        }

        const baseWorldState = await this.buildBaseWorldStateWithoutSession(platform, channelId, bot);

        return {
            ...baseWorldState,
            triggerContext: {
                type: "background_task_completion",
                taskId: stimulus.payload.taskId,
                taskType: stimulus.payload.taskType,
                result: stimulus.payload.result,
                error: stimulus.payload.error,
                completedAt: stimulus.payload.completedAt,
            },
        };
    }

    /**
     * 构建基础世界状态（有 session 的情况）
     */
    /**
     * 获取与指定频道链接的所有频道
     */
    private getLinkedChannels(platform: string, channelId: string): { platform: string; channelId: string }[] {
        if (!this.config.linkedChannelGroups) {
            return [];
        }

        // 查找包含当前频道的链接组
        const linkedGroup = this.config.linkedChannelGroups.find(group =>
            group.channels.some(ch => {
                // 支持通配符匹配
                if (ch.platform === "*" || ch.platform === platform) {
                    return ch.id === "*" || ch.id === channelId;
                }
                return false;
            })
        );

        if (!linkedGroup) {
            return [];
        }

        // 返回组内其他频道（不包括当前频道）
        return linkedGroup.channels
            .filter(ch => {
                // 过滤掉当前频道本身
                if (ch.platform === platform && ch.id === channelId) {
                    return false;
                }
                // 如果是通配符，则跳过（通配符不代表具体频道）
                if (ch.platform === "*" || ch.id === "*") {
                    return false;
                }
                return true;
            })
            .map(ch => ({ platform: ch.platform, channelId: ch.id }));
    }

    /**
     * 获取链接频道组的配置
     */
    private getLinkedChannelGroupConfig(platform: string, channelId: string) {
        if (!this.config.linkedChannelGroups) {
            return null;
        }

        return this.config.linkedChannelGroups.find(group =>
            group.channels.some(ch => {
                if (ch.platform === "*" || ch.platform === platform) {
                    return ch.id === "*" || ch.id === channelId;
                }
                return false;
            })
        );
    }

    private async buildBaseWorldState(platform: string, channelId: string, session: Session): Promise<WorldState> {
        const { isDirect, bot } = session;

        // 获取当前频道的历史记录
        let raw_l1_history = await this.interactionManager.getL1History(platform, channelId, this.config.l1_memory.maxMessages);

        // 检查是否有链接的频道组
        const linkedChannels = this.getLinkedChannels(platform, channelId);
        const groupConfig = this.getLinkedChannelGroupConfig(platform, channelId);

        if (linkedChannels.length > 0 && groupConfig) {
            // 获取链接频道的历史记录
            const linkedHistories = await Promise.all(
                linkedChannels.map(async ({ platform: linkPlatform, channelId: linkChannelId }) => {
                    const linkLimit = Math.min(
                        groupConfig.maxMessagesPerChannel || 10,
                        Math.floor(this.config.l1_memory.maxMessages / (linkedChannels.length + 1))
                    );
                    const linkHistory = await this.interactionManager.getL1History(linkPlatform, linkChannelId, linkLimit);
                    
                    // 过滤过旧的消息
                    if (groupConfig.maxMessageAge) {
                        const cutoffTime = new Date(Date.now() - groupConfig.maxMessageAge * 1000);
                        return linkHistory.filter(item => item.timestamp >= cutoffTime);
                    }
                    
                    return linkHistory;
                })
            );

            // 合并所有历史记录
            const allHistory = [...raw_l1_history, ...linkedHistories.flat()];
            
            // 按时间排序并限制总数量
            allHistory.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            raw_l1_history = allHistory.slice(-this.config.l1_memory.maxMessages);
        }

        const isL1Overloaded = raw_l1_history.length >= this.config.l1_memory.maxMessages * 0.8;

        const l1_history = this.applyGracefulDegradation(raw_l1_history);

        const { processed_events, new_events } = this.partitionL1History(session.selfId, l1_history);

        let retrieved_memories = [];
        if (isL1Overloaded) {
            const earliestMessageTimestamp = raw_l1_history
                .filter((e) => e.type === "message")
                .map((e) => e.timestamp)
                .reduce((earliest, current) => (current < earliest ? current : earliest), new Date());

            try {
                retrieved_memories = await this.retrieveL2Memories(new_events, {
                    platform,
                    channelId,
                    k: this.config.l2_memory.retrievalK,
                    endTimestamp: earliestMessageTimestamp,
                });
                this.ctx.logger.info(`成功检索 ${retrieved_memories.length} 条召回记忆`);
            } catch (error: any) {
                this.ctx.logger.error(`L2 语义检索失败: ${error.message}`);
            }
        } else {
            retrieved_memories = [];
        }

        const diary_entries = await this.retrieveL3Memories(channelId);

        const channelInfo = await this.getChannelInfo(bot, channelId, isDirect);
        const selfInfo = await this.getSelfInfo(bot);

        const users = [];

        if (isDirect) {
            users.push({
                id: session.userId,
                name: session.author.name,
                description: "",
            });
            users.push({
                id: session.selfId,
                name: selfInfo.name,
                roles: ["self"],
                description: "",
            });
        } else {
            let selfInGuild: Awaited<ReturnType<Bot["getGuildMember"]>>;
            try {
                selfInGuild = await session.bot.getGuildMember(channelId, session.selfId);
            } catch (error: any) {
                this.ctx.logger.error(`获取机器人自身信息失败 for id ${session.selfId}: ${error.message}`);
            }

            users.push({
                id: session.selfId,
                name: selfInGuild?.nick || selfInGuild?.name || selfInfo.name,
                roles: ["self", ...(selfInGuild?.roles || [])],
                description: "",
            });

            l1_history.forEach((item) => {
                if (item.type === "message") {
                    if (!users.find((u) => u.id === item.sender.id)) {
                        users.push({
                            id: item.sender.id,
                            name: item.sender.name,
                            roles: item.sender.roles,
                            description: "",
                        });
                    }
                }
            });
        }

        return {
            channel: {
                id: channelId,
                name: channelInfo.name,
                type: session.isDirect ? "private" : "guild",
                platform: platform,
            },
            current_time: new Date().toISOString(),
            self: selfInfo,
            working_memory: { processed_events, new_events },
            retrieved_memories,
            diary_entries,
            users: users,
        };
    }

    /**
     * 构建基础世界状态（没有 session 的情况，用于定时任务等）
     */
    private async buildBaseWorldStateWithoutSession(platform: string, channelId: string, bot: Bot): Promise<WorldState> {
        // 获取当前频道的历史记录
        let raw_l1_history = await this.interactionManager.getL1History(platform, channelId, this.config.l1_memory.maxMessages);

        // 检查是否有链接的频道组
        const linkedChannels = this.getLinkedChannels(platform, channelId);
        const groupConfig = this.getLinkedChannelGroupConfig(platform, channelId);

        if (linkedChannels.length > 0 && groupConfig) {
            // 获取链接频道的历史记录
            const linkedHistories = await Promise.all(
                linkedChannels.map(async ({ platform: linkPlatform, channelId: linkChannelId }) => {
                    const linkLimit = Math.min(
                        groupConfig.maxMessagesPerChannel || 10,
                        Math.floor(this.config.l1_memory.maxMessages / (linkedChannels.length + 1))
                    );
                    const linkHistory = await this.interactionManager.getL1History(linkPlatform, linkChannelId, linkLimit);
                    
                    // 过滤过旧的消息
                    if (groupConfig.maxMessageAge) {
                        const cutoffTime = new Date(Date.now() - groupConfig.maxMessageAge * 1000);
                        return linkHistory.filter(item => item.timestamp >= cutoffTime);
                    }
                    
                    return linkHistory;
                })
            );

            // 合并所有历史记录
            const allHistory = [...raw_l1_history, ...linkedHistories.flat()];
            
            // 按时间排序并限制总数量
            allHistory.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
            raw_l1_history = allHistory.slice(-this.config.l1_memory.maxMessages);
        }

        const isL1Overloaded = raw_l1_history.length >= this.config.l1_memory.maxMessages * 0.8;

        const l1_history = this.applyGracefulDegradation(raw_l1_history);

        const { processed_events, new_events } = this.partitionL1History(bot.selfId, l1_history);

        let retrieved_memories = [];
        if (isL1Overloaded && new_events.length > 0) {
            const earliestMessageTimestamp = raw_l1_history
                .filter((e) => e.type === "message")
                .map((e) => e.timestamp)
                .reduce((earliest, current) => (current < earliest ? current : earliest), new Date());

            try {
                retrieved_memories = await this.retrieveL2Memories(new_events, {
                    platform,
                    channelId,
                    k: this.config.l2_memory.retrievalK,
                    endTimestamp: earliestMessageTimestamp,
                });
                this.ctx.logger.info(`成功检索 ${retrieved_memories.length} 条召回记忆`);
            } catch (error: any) {
                this.ctx.logger.error(`L2 语义检索失败: ${error.message}`);
            }
        }

        const diary_entries = await this.retrieveL3Memories(channelId);

        // 获取频道信息
        let channelInfo: { id: string; name: string };
        try {
            const channel = await bot.getChannel(channelId);
            channelInfo = { id: channelId, name: channel.name || "未知频道" };
        } catch (error: any) {
            this.ctx.logger.debug(`获取频道信息失败 for channel ${channelId}: ${error.message}`);
            channelInfo = { id: channelId, name: "未知频道" };
        }

        // 获取机器人自身信息
        const selfInfo = {
            id: bot.selfId,
            name: bot.user.nick || bot.user.name || "Bot",
        };

        // 从历史记录中提取用户信息
        const users = [];
        users.push({
            id: bot.selfId,
            name: selfInfo.name,
            roles: ["self"],
            description: "",
        });

        l1_history.forEach((item) => {
            if (item.type === "message") {
                if (!users.find((u) => u.id === item.sender.id)) {
                    users.push({
                        id: item.sender.id,
                        name: item.sender.name,
                        roles: item.sender.roles,
                        description: "",
                    });
                }
            }
        });

        return {
            channel: {
                id: channelId,
                name: channelInfo.name,
                type: "guild", // 定时任务通常不在私聊中触发
                platform: platform,
            },
            current_time: new Date().toISOString(),
            self: selfInfo,
            working_memory: { processed_events, new_events },
            retrieved_memories,
            diary_entries,
            users: users,
        };
    }

    /**
     * 裁剪过期的智能体响应
     */
    private applyGracefulDegradation(history: L1HistoryItem[]): L1HistoryItem[] {
        const turnIdsToKeep = new Set<string>();
        const turnIdsToDrop = new Set<string>();

        // 从后往前遍历，找到超出保留数量的思考事件，并记录它们的 turnId
        for (let i = history.length - 1; i >= 0; i--) {
            const item = history[i];
            if (
                item.type === "agent_thought" ||
                item.type === "agent_action" ||
                item.type === "agent_observation" ||
                item.type === "agent_heartbeat"
            ) {
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
            if (
                item.type === "agent_thought" ||
                item.type === "agent_action" ||
                item.type === "agent_observation" ||
                item.type === "agent_heartbeat"
            ) {
                const turnId = item.turnId;
                return !turnIdsToDrop.has(turnId);
            }
            return true; // 保留所有非 agent 事件
        });
    }

    private async retrieveL2Memories(
        new_events: L1HistoryItem[],
        filter?: { platform?: string; channelId?: string; k?: number; startTimestamp?: Date; endTimestamp?: Date }
    ): Promise<RetrievedMemoryChunk[]> {
        if (!this.config.l2_memory.enabled || new_events.length === 0) return [];

        const queryMessages = new_events.filter((e): e is { type: "message" } & ContextualMessage => e.type === "message");

        if (queryMessages.length === 0) return [];

        const queryText = this.l2Manager.compileEventsToText(queryMessages);

        if (!queryText) return [];

        try {
            const retrieved = await this.l2Manager.search(queryText, {
                platform: filter?.platform,
                channelId: filter?.channelId,
                k: this.config.l2_memory.retrievalK,
                startTimestamp: filter?.startTimestamp,
                endTimestamp: filter?.endTimestamp,
            });
            return retrieved.map((chunk) => ({
                content: chunk.content,
                relevance: chunk.similarity,
                timestamp: chunk.startTimestamp,
            }));
        } catch (error: any) {
            this.ctx.logger.error(`检索 L2 记忆时发生错误: ${error.message}`);
            return [];
        }
    }

    // TODO
    private async retrieveL3Memories(channelId: string): Promise<DiaryEntryData[]> {
        if (!this.config.l3_memory.enabled) return [];
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split("T")[0];
        return this.ctx.database.get(TableName.L3Diaries, { channelId, date: dateStr });
    }

    private async getChannelInfo(bot: Bot, channelId: string, isDirect?: boolean) {
        let channelInfo: Awaited<ReturnType<Bot["getChannel"]>>;
        let channelName = "";

        if (isDirect) {
            let userInfo: Awaited<ReturnType<Bot["getUser"]>>;
            try {
                userInfo = await bot.getUser(channelId);
            } catch (error: any) {
                this.ctx.logger.debug(`获取用户信息失败 for user ${channelId}: ${error.message}`);
            }

            channelName = `与 ${userInfo?.name || channelId} 的私聊`;
        } else {
            try {
                channelInfo = await bot.getChannel(channelId);
                channelName = channelInfo.name;
            } catch (error: any) {
                this.ctx.logger.debug(`获取频道信息失败 for channel ${channelId}: ${error.message}`);
            }
            channelName = channelInfo?.name || "未知群组";
        }

        return { id: channelId, name: channelName };
    }

    private async getSelfInfo(bot: Bot) {
        const selfId = bot.user.id;
        try {
            const user = await bot.getUser(selfId);
            return { id: selfId, name: user.name };
        } catch (error: any) {
            this.ctx.logger.debug(`获取机器人自身信息失败 for id ${selfId}: ${error.message}`);
            return { id: selfId, name: bot.user.name || "Self" };
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
            // 如果 item 是一个消息，则它需要发送者不是机器人自身才算"新"
            // 如果 item 不是消息，则这个条件始终为 true，也就是说只要时间戳满足，非消息类型就总是"新"的
            item.is_new = item.timestamp > lastAgentTurnTime && (item.type === "message" ? item.sender.id !== selfId : true);

            (item as any).is_message = item.type === "message";
            (item as any).is_agent_thought = item.type === "agent_thought";
            (item as any).is_agent_action = item.type === "agent_action";
            (item as any).is_agent_observation = item.type === "agent_observation";
            (item as any).is_agent_heartbeat = item.type === "agent_heartbeat";
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
