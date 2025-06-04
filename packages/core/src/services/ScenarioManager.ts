import { $, Context, Service, Session } from "koishi";
import { Scenario } from "../Scenario";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message } from "../types/model";

declare module "koishi" {
    interface Events {
        "scenario/clear": (channelId: string) => void;
        "scenario/clearAll": () => void;
    }
}

/**
 * Scenario 管理器。
 * 负责 Scenario 实例的生命周期、缓存和增量更新。
 */
export class ScenarioManager {
    private scenarios: Map<string, Scenario> = new Map();
    constructor(private ctx: Context) {
        ctx.on("scenario/clear", (channelId) => {
            this.clearScenario(channelId);
        });
        ctx.on("scenario/clearAll", () => {
            this.clearAllScenario();
        });
    }

    /**
     * 获取或创建指定频道的 Scenario 实例。
     * 如果缓存中存在，则直接返回。如果不存在，则创建并加载初始数据。
     * @param session 当前会话，用于获取 channelId 及初始化 Scenario
     * @param limit 加载历史消息的数量限制
     */
    async getScenario(session: Session, limit: number = 30): Promise<Scenario> {
        const channelId = session.channelId;
        if (!channelId) {
            throw new Error("获取 Scenario 需要 Channel ID。");
        }
        if (this.scenarios.has(channelId)) {
            return this.scenarios.get(channelId)!;
        }
        // 缓存中不存在，创建新的 Scenario 实例并加载初始数据
        const scenario = new Scenario(this.ctx, session, limit);
        await scenario.loadInitialData();
        this.scenarios.set(channelId, scenario);
        return scenario;
    }

    /**
     * 获取已经加载的 Scenario 实例。
     * 如果不存在，则返回 undefined。
     * @param channelId
     * @returns
     */
    public getScenarioByChannelId(channelId: string): Scenario | undefined {
        return this.scenarios.get(channelId);
    }

    /**
     * 更新 Scenario 中的消息。
     * 当有新消息（无论是用户发送还是机器人发送）时调用。
     * @param message 消息对象
     * @param session 关联的会话
     * @param isNewMessage 是否为新消息，机器人尚未处理
     */
    async updateMessage(message: Message, session: Session, isNewMessage: boolean): Promise<void> {
        const scenario = await this.getScenario(session);
        scenario.addContext(message, isNewMessage);
    }

    /**
     * 更新 Scenario 中的交互记录。
     * 当工具调用或结果返回时调用。
     * @param interaction 交互对象
     * @param session 关联的会话
     * @param isNewMessage 是否为新交互，机器人尚未处理
     */
    async updateInteraction(interaction: Interaction, session: Session, isNewMessage: boolean): Promise<void> {
        const scenario = await this.getScenario(session);
        scenario.addContext(interaction, isNewMessage);
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

    clearScenario(channelId: string): void {
        const removed = this.scenarios.delete(channelId);
        if (removed) {
            this.ctx.logger.debug(`[ScenarioManager] 频道 ${channelId} 的 Scenario 实例已从缓存中清除。`);
        }
    }

    clearAllScenario(): void {
        this.scenarios.clear();
        this.ctx.logger.info(`[ScenarioManager] 所有 Scenario 实例已从缓存中清除。`);
    }

    /**
     * 获取所有活跃的 Scenario 实例列表，供 PromptBuilder 渲染。
     */
    public getActiveScenariosForRender(): Scenario[] {
        const activeScenarios: Scenario[] = [];
        for (const scenario of this.scenarios.values()) {
            if (scenario.isActive) {
                activeScenarios.push(scenario);
            }
        }
        return activeScenarios;
    }

    /**
     * 获取所有不活跃的 Scenario 实例列表（主要指群聊），供 PromptBuilder 渲染。
     */
    public getInactiveScenariosForRender(): Scenario[] {
        const inactiveScenarios: Scenario[] = [];
        for (const scenario of this.scenarios.values()) {
            if (!scenario.isActive) {
                inactiveScenarios.push(scenario);
            }
        }
        return inactiveScenarios;
    }

    // 移除原有的 render 方法，其职责已转移到 PromptBuilder
    // public render(channels: string[]): string { /* ... */ }
}
