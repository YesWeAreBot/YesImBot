import { $, Context, Session } from "koishi";
import { Scenario } from "../Scenario";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message } from "../types/model";


/**
 * Scenario 管理器。
 * 负责 Scenario 实例的生命周期、缓存和增量更新。
 */
export class ScenarioManager {
    private scenarios: Map<string, Scenario> = new Map();
    private ctx: Context;
    constructor(ctx: Context) {
        this.ctx = ctx;
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
        const scenario = new Scenario(this.ctx, session);
        await scenario.loadInitialData(limit);
        this.scenarios.set(channelId, scenario);
        // this.ctx.logger.info(`[ScenarioManager] 为频道 ${channelId} 创建并加载了新的 Scenario 实例。`);
        return scenario;
    }

    /**
     * 更新 Scenario 中的消息。
     * 当有新消息（无论是用户发送还是机器人发送）时调用。
     * @param message 消息对象
     * @param session 关联的会话
     * @param isBotMessage 是否为机器人自身发送的消息（影响已读/未读状态）
     */
    async updateMessage(message: Message, session: Session, isBotMessage: boolean): Promise<void> {
        const channelId = message.channel.id;
        const scenario = await this.getScenario(session); // 确保 Scenario 实例已加载
        // 机器人自身发送的消息对机器人而言是已读的，用户发送的消息是未读的
        scenario.addContext(message, isBotMessage);
        // this.ctx.logger.info(`[ScenarioManager] 频道 ${channelId} 增量更新消息: ${message.messageId}`);
    }

    /**
     * 更新 Scenario 中的交互记录。
     * 当工具调用或结果返回时调用。
     * @param interaction 交互对象
     * @param session 关联的会话
     */
    async updateInteraction(interaction: Interaction, session: Session, isRead: boolean): Promise<void> {
        const channelId = session.channelId; // 交互通常与当前会话频道相关联
        const scenario = await this.getScenario(session); // 确保 Scenario 实例已加载
        // 交互记录通常是新的信息，标记为未读以供 AI 重点关注
        scenario.addContext(interaction, isRead);
        // this.ctx.logger.info(`[ScenarioManager] 频道 ${channelId} 增量更新交互: ${interaction.id}`);
    }

    /**
     * 处理交互记录的生命周期：递减 'life' 值并移除过期记录。
     * 在 LLM 处理之前调用，确保上下文中的交互记录是最新的。
     * @param channelId 频道ID
     */
    async processInteractions(channelId: string): Promise<void> {
        const interactions = await this.ctx.database
            .select(INTERACTION_TABLE)
            .where({ emitter_channel_id: channelId }) // 使用新的 emitter_channel_id 字段
            .execute();
        for (const interaction of interactions) {
            let life = interaction.life;
            if (life > 0) {
                // 递减 life 值
                await this.ctx.database
                    .set(INTERACTION_TABLE, { id: interaction.id }, { life: $.subtract(life, 1) });
                // this.ctx.logger.info(`[ScenarioManager] 交互 ${interaction.id} 的生命周期递减至 ${life - 1}。`);
            } else {
                // 移除过期交互
                await this.ctx.database
                    .remove(INTERACTION_TABLE, { id: interaction.id });
                // this.ctx.logger.info(`[ScenarioManager] 交互 ${interaction.id} 已过期并被移除。`);
            }
        }
    }

    /**
     * 设置指定频道的最后回复时间。
     * 在机器人成功回复后调用，用于标记已读消息的截止时间。
     * @param channelId 频道ID
     */
    async setLastReplyTime(channelId: string): Promise<void> {
        await this.ctx.database.upsert(LAST_REPLY_TABLE, [{
            channelId: channelId,
            timestamp: new Date()
        }], ['channelId']);
        // this.ctx.logger.info(`[ScenarioManager] 频道 ${channelId} 的最后回复时间已更新。`);
    }

    /**
     * 清除指定频道的 Scenario 实例缓存。
     * @param channelId 频道ID
     */
    clearScenario(channelId: string): void {
        if (this.scenarios.delete(channelId)) {
            // this.ctx.logger.info(`[ScenarioManager] 频道 ${channelId} 的 Scenario 实例已从缓存中清除。`);
        }
    }
}
