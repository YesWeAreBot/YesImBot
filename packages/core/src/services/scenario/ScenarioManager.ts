import { $, Context, Session } from "koishi";
import { ChatMessage, Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE } from "../../types/model";
import { Scenario } from "./Scenario";
import { ContextProcessor } from "./ContextProcessor";

declare module "koishi" {
    interface Events {
        "scenario/clear": (channelId: string) => void;
        "scenario/clearAll": () => void;
    }
}

/**
 * 统一的场景管理器
 */
export class ScenarioManager {
    private scenarios: Map<string, Scenario> = new Map();
    private contextProcessor?: ContextProcessor;

    constructor(
        private ctx: Context,
        private multimodalConfig: any,
        private config?: {
            UseModel: [number, number];
            enableEnhancedContext?: boolean;
            contextWindowTokens?: number;
        }
    ) {
        if (config?.enableEnhancedContext) {
            if (!ctx["yesimbot.model"]) {
                ctx.logger.warn(
                    "[ScenarioManager] Enhanced context is enabled, but no LLM service is available. Feature will be disabled."
                );
            } else {
                const chatModel = ctx["yesimbot.model"].getChatModel(config.UseModel);
                this.contextProcessor = new ContextProcessor(ctx, chatModel);
            }
        }

        ctx.on("scenario/clear", (channelId) => this.clearScenario(channelId));
        ctx.on("scenario/clearAll", () => this.clearAllScenarios());
    }

    /**
     * 获取或创建场景实例
     */
    async getScenario(session: Session, limit: number = 30): Promise<Scenario> {
        const channelId = session.channelId;
        if (!channelId) {
            throw new Error("获取 Scenario 需要 Channel ID。");
        }

        let scenario = this.scenarios.get(channelId);

        if (!scenario) {
            scenario = new Scenario(this.ctx, session, limit, this.multimodalConfig);
            await scenario.load();
            this.scenarios.set(channelId, scenario);
        }

        // 如果启用了增强功能且场景有新消息，则进行分析
        if (this.contextProcessor && scenario.isActive) {
            await this.contextProcessor.analyze(scenario);
        }

        return scenario;
    }

    /**
     * 更新场景中的消息
     */
    async updateMessage(message: ChatMessage, session: Session, isNewMessage: boolean): Promise<void> {
        // 先获取或创建场景，确保场景存在于缓存中
        const scenario = await this.getScenario(session);
        scenario.addMessage(message, isNewMessage);
    }

    /**
     * 更新场景中的交互记录
     * 当工具调用或结果返回时调用。
     * @param interaction 交互对象
     * @param session 关联的会话
     * @param isNewMessage 是否为新交互，机器人尚未处理
     */
    async updateInteraction(interaction: Interaction, session: Session, isNewMessage: boolean): Promise<void> {
        const scenario = await this.getScenario(session);
        scenario.addMessage(interaction, isNewMessage);
    }

    /**
     * 处理交互记录的生命周期：递减 'life' 值并移除过期记录。
     * 此函数在 Koishi LLMChain 处理之前调用，确保上下文中的交互记录是最新的。
     * 优化：使用批处理 SQL 语句。
     * 新增：同步更新内存中 Scenario 实例的 Interaction 生命周期。
     * @param channelId 频道ID
     */
    async processInteractions(channelId: string): Promise<void> {
        try {
            // 1. 递减数据库中所有有效交互的 life 值
            const updateResult = await this.ctx.database.set(
                INTERACTION_TABLE,
                {
                    $and: [{ emitter_channel_id: channelId }, { life: { $gt: 0 } }],
                },
                (row) => ({ life: $.subtract(row.life, 1) })
            );

            // 2. 移除数据库中 life 值小于等于 0 的过期交互
            const removalResult = await this.ctx.database.remove(INTERACTION_TABLE, {
                $and: [{ emitter_channel_id: channelId }, { life: { $lte: 0 } }],
            });

            // 3. 同步更新内存中 Scenario 实例的 Interaction 生命周期
            const scenario = this.scenarios.get(channelId);
            if (scenario) {
                scenario.syncAndPruneInteractions();
            } else {
                this.ctx.logger.warn(`[ScenarioManager] 尝试处理不在缓存中的频道 ${channelId} 的交互。`);
            }
        } catch (error: any) {
            this.ctx.logger.error(`[ScenarioManager] 处理频道 ${channelId} 交互时出错: ${error.message}`);
        }
    }

    /**
     * 设置指定频道的最后回复时间。
     * 在机器人成功回复后调用，用于标记已读消息的截止时间。
     * @param channelId 频道ID
     */
    async setLastReplyTime(channelId: string): Promise<void> {
        await this.ctx.database.upsert(LAST_REPLY_TABLE, [{ channelId: channelId, timestamp: new Date() }], ["channelId"]);
    }

    /**
     * 清除指定频道的场景
     */
    clearScenario(channelId: string): void {
        this.scenarios.delete(channelId);
        this.ctx.logger.debug(`[ScenarioManager] 频道 ${channelId} 的场景已清除。`);
    }

    /**
     * 清除所有场景
     */
    clearAllScenarios(): void {
        this.scenarios.clear();
        this.ctx.logger.info(`[ScenarioManager] 所有场景已清除。`);
    }

    /**
     * 获取所有活跃的 Scenario 实例列表，供 PromptBuilder 渲染。
     */
    public getActiveScenariosForRender(allowedChannels: string[]): Scenario[] {
        const activeScenarios: Scenario[] = [];
        for (const scenario of this.scenarios.values()) {
            if (allowedChannels.includes(scenario.id) && scenario.isActive) {
                activeScenarios.push(scenario);
            }
        }
        return activeScenarios;
    }

    /**
     * 获取所有不活跃的 Scenario 实例列表（主要指群聊），供 PromptBuilder 渲染。
     */
    public getInactiveScenariosForRender(allowedChannels: string[]): Scenario[] {
        const inactiveScenarios: Scenario[] = [];
        for (const scenario of this.scenarios.values()) {
            if (allowedChannels.includes(scenario.id) && !scenario.isActive) {
                inactiveScenarios.push(scenario);
            }
        }
        return inactiveScenarios;
    }
}
