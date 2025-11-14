import type { Context } from "koishi";
import type { SceneAdapter } from "./adapters/base";
import type { HistoryConfig } from "./config";
import type { WorldStateService } from "./service";
import type { AnyStimulus, DiaryEntry, Environment, Memory, SelfInfo, WorldState } from "./types";
import { Time } from "koishi";
import { ChatSceneAdapter } from "./adapters/chat-adapter";
import { isScopedStimulus } from "./types";

/**
 * WorldState 构建器
 *
 * 负责从 Stimulus 构建完整的 WorldState
 */
export class WorldStateBuilder {
    private adapters: SceneAdapter[] = [];

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private service: WorldStateService,
    ) {
        // 注册内置适配器
        this.registerAdapter(new ChatSceneAdapter(ctx, config, service.recorder));
    }

    /**
     * 注册场景适配器
     */
    registerAdapter(adapter: SceneAdapter): void {
        this.adapters.push(adapter);
    }

    /**
     * 从 Stimulus 构建 WorldState
     */
    async buildFromStimulus(stimulus: AnyStimulus): Promise<WorldState> {
        // 判断是 scoped 还是 global
        const isScoped = isScopedStimulus(stimulus);

        if (isScoped) {
            // 选择合适的适配器
            const adapter = this.selectAdapter(stimulus);

            if (!adapter) {
                throw new Error(`No scene adapter found for stimulus: ${stimulus.type}`);
            }

            return this.buildScopedState(stimulus, adapter);
        } else {
            return this.buildGlobalState(stimulus);
        }
    }

    private selectAdapter(stimulus: AnyStimulus): SceneAdapter | null {
        for (const adapter of this.adapters) {
            if (adapter.canHandle(stimulus)) {
                return adapter;
            }
        }
        return null;
    }

    private async buildScopedState(stimulus: AnyStimulus, adapter: SceneAdapter): Promise<WorldState> {
        // 构建环境
        const environment = await adapter.buildEnvironment(stimulus);

        // 构建实体列表
        const entities = environment ? await adapter.buildEntities(stimulus, environment) : [];

        // 构建事件历史
        const eventHistory = environment ? await adapter.buildEventHistory(stimulus, environment) : [];

        // 构建扩展数据
        const extensions = environment ? await adapter.buildExtensions(stimulus, environment) : {};

        // 检索记忆 (通用逻辑)
        const retrievedMemories = await this.retrieveMemories(stimulus, environment);

        return {
            stateType: "scoped",
            trigger: {
                type: stimulus.type,
                timestamp: stimulus.timestamp,
                description: this.describeTrigger(stimulus),
            },
            self: await this.getSelfInfo(),
            currentTime: new Date(Time.getDateNumber()),
            environment,
            entities,
            eventHistory,
            retrievedMemories,
            extensions,
        };
    }

    private async buildGlobalState(stimulus: AnyStimulus): Promise<WorldState> {
        // 全局状态不绑定特定环境
        return {
            stateType: "global",
            trigger: {
                type: stimulus.type,
                timestamp: stimulus.timestamp,
                description: this.describeTrigger(stimulus),
            },
            self: await this.getSelfInfo(),
            currentTime: new Date(),
            // 全局状态可以包含所有环境的概览
            extensions: {
                allEnvironments: await this.getAllEnvironments(),
            },
        };
    }

    /**
     * 检索相关记忆 (L2 语义记忆)
     */
    private async retrieveMemories(stimulus: AnyStimulus, environment?: Environment): Promise<Memory[]> {
        // TODO: 实现 L2 记忆检索
        return [];
    }

    /**
     * 检索日记条目 (L3 自我反思)
     */
    private async retrieveDiaryEntries(stimulus: AnyStimulus): Promise<DiaryEntry[]> {
        // TODO: 实现 L3 日记检索
        return [];
    }

    /**
     * 生成刺激的描述文本
     */
    private describeTrigger(stimulus: AnyStimulus): string {
        switch (stimulus.type) {
            case "user_message": {
                const session = stimulus.payload as any;
                return `用户 ${session.username || session.userId} 在 ${session.channelId} 发送了消息`;
            }
            default:
                return `未知类型: ${stimulus.type}`;
        }
    }

    /**
     * 获取智能体自身信息
     */
    private async getSelfInfo(): Promise<SelfInfo> {
        // 获取第一个可用的 bot
        const bots = Array.from(this.ctx.bots.values());
        if (bots.length === 0) {
            return {
                id: "unknown",
                name: "unknown",
            };
        }

        const bot = bots[0];
        try {
            const user = await bot.getUser(bot.selfId);
            return {
                id: bot.selfId,
                name: user.name || bot.user?.name || "unknown",
                avatar: user.avatar,
                platform: bot.platform,
            };
        } catch (error: any) {
            this.ctx.logger.debug(`获取机器人自身信息失败: ${error.message}`);
            return {
                id: bot.selfId,
                name: bot.user?.name || "unknown",
                platform: bot.platform,
            };
        }
    }

    /**
     * 获取所有环境的概览（用于全局状态）
     */
    private async getAllEnvironments(): Promise<Environment[]> {
        // TODO: 实现获取所有活跃环境的逻辑
        return [];
    }
}
