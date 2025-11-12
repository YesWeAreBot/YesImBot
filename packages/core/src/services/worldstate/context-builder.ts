import type { Bot, Context, Session } from "koishi";
import type { HistoryConfig } from "./config";
import type { HistoryManager } from "./history-manager";
import type {
    AnyAgentStimulus,
    AnyWorldState,
    ChannelBoundStimulus,
    ChannelEventStimulus,
    ChannelWorldState,
    GlobalEventStimulus,
    GlobalStimulus,
    GlobalWorldState,
    SelfInitiatedStimulus,
    UserMessageStimulus,
} from "./types";

import { StimulusSource } from "./types";

export class ContextBuilder {
    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private history: HistoryManager,
    ) {}

    public async buildFromStimulus(stimulus: AnyAgentStimulus): Promise<AnyWorldState> {
        switch (stimulus.type) {
            case StimulusSource.UserMessage:
            case StimulusSource.ChannelEvent:
                // 这些刺激源明确需要频道上下文
                return this.buildChannelWorldState(stimulus as UserMessageStimulus | ChannelEventStimulus);

            case StimulusSource.GlobalEvent:
            case StimulusSource.SelfInitiated:
                // 这些刺激源明确需要全局上下文
                return this.buildGlobalWorldState(stimulus as GlobalEventStimulus | SelfInitiatedStimulus);

            case StimulusSource.ScheduledTask:
            case StimulusSource.BackgroundTaskCompletion:
                // 这些需要根据 payload 判断
                if (stimulus.payload.channelId && stimulus.payload.platform) {
                    return this.buildChannelWorldState(stimulus);
                }
                else {
                    return this.buildGlobalWorldState(stimulus);
                }

            default:
                const _exhaustive: never = stimulus;
                throw new Error(`Unsupported stimulus type: ${(stimulus as any).type}`);
        }
    }

    // --- 方法一：构建频道上下文 ---
    private async buildChannelWorldState(stimulus: ChannelBoundStimulus): Promise<ChannelWorldState> {
        const { platform, channelId } = stimulus.payload;
        const bot = this.getBot(platform);
        const session: Session = stimulus.type === StimulusSource.UserMessage ? stimulus.payload : undefined;

        const selfInfo = await this.getSelfInfo(bot);

        const l1_history = await this.history.getL1History(platform, channelId, this.config.l1_memory.maxMessages);

        const isDirect = session ? session.isDirect : (await bot.getChannel(channelId))?.type === 1;
        const channelInfo = await this.getChannelInfo(bot, channelId, isDirect);
        const users = [];

        return {
            contextType: "channel",
            triggerContext: this.createTriggerContext(stimulus),
            self: selfInfo,
            current_time: new Date().toISOString(),
            channel: { ...channelInfo, type: isDirect ? "private" : "guild", platform },
            users,
            history: l1_history,
        };
    }

    // --- 方法二：构建全局上下文 ---
    private async buildGlobalWorldState(stimulus: GlobalStimulus): Promise<GlobalWorldState> {
        throw new Error("Not implemented");
        // const bot = this.getBot(); // 获取一个默认 bot
        // const selfInfo = await this.getSelfInfo(bot);

        // // 1. 全局上下文没有 L1，但有 L2 和 L3
        // const queryText = this.getQueryTextForGlobalStimulus(stimulus);
        // const retrieved_memories = queryText ? await this.retrieveL2MemoriesFromText(queryText) : [];
        // const diary_entries = await this.l3Manager.getRecentDiaries(3); // 获取最近的日记进行反思

        // // 2. (可选) 获取活跃频道列表，赋予 Agent 行动目标
        // // 这个功能需要额外实现，比如从数据库中查询最近有消息的频道
        // // const active_channels_summary = await this.getActiveChannelsSummary();

        // // 3. 返回结构化的 GlobalWorldState
        // return {
        //     contextType: "global",
        //     triggerContext: this.createTriggerContext(stimulus),
        //     self: selfInfo,
        //     current_time: new Date().toISOString(),
        //     l2_retrieved_memories: retrieved_memories,
        //     l3_diary_entries: diary_entries,
        //     // active_channels_summary,
        // };
    }

    private getBot(platform?: string): Bot {
        if (platform) {
            const bot = this.ctx.bots.find(b => b.platform === platform);
            if (bot)
                return bot;
            throw new Error(`No bot found for platform: ${platform}`);
        }
        if (this.ctx.bots.length > 0) {
            return this.ctx.bots[0];
        }
        throw new Error("No bots are available in the context.");
    }

    private async getChannelInfo(bot: Bot, channelId: string, isDirect?: boolean) {
        let channelInfo: Awaited<ReturnType<Bot["getChannel"]>>;
        let channelName = "";

        if (isDirect) {
            let userInfo: Awaited<ReturnType<Bot["getUser"]>>;
            try {
                userInfo = await bot.getUser(channelId);
            }
            catch (error: any) {
                this.ctx.logger.debug(`获取用户信息失败 for user ${channelId}: ${error.message}`);
            }

            channelName = `与 ${userInfo?.name || channelId} 的私聊`;
        }
        else {
            try {
                channelInfo = await bot.getChannel(channelId);
                channelName = channelInfo.name;
            }
            catch (error: any) {
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
        }
        catch (error: any) {
            this.ctx.logger.debug(`获取机器人自身信息失败 for id ${selfId}: ${error.message}`);
            return { id: selfId, name: bot.user.name || "Self" };
        }
    }

    // 新增的辅助方法，用于创建触发上下文
    private createTriggerContext(stimulus: AnyAgentStimulus): object {
        switch (stimulus.type) {
            case StimulusSource.UserMessage:
                return { type: "user_message", sender: stimulus.payload.author };
            case StimulusSource.ChannelEvent:
                return {
                    type: "channel_event",
                    eventType: stimulus.payload.eventType,
                    message: stimulus.payload.message,
                    details: stimulus.payload.details,
                };
            case StimulusSource.ScheduledTask:
                return {
                    type: "scheduled_task",
                    taskId: stimulus.payload.taskId,
                    taskType: stimulus.payload.taskType,
                    params: stimulus.payload.params,
                };
            case StimulusSource.BackgroundTaskCompletion:
                return {
                    type: "background_task_completion",
                    taskId: stimulus.payload.taskId,
                    taskType: stimulus.payload.taskType,
                    result: stimulus.payload.result,
                    error: stimulus.payload.error,
                };
            // 其他 case...
            default:
                return { type: "unknown" };
        }
    }
}
