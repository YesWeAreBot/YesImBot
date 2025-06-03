import { $, Context, Service, Session } from "koishi";
import { Scenario } from "../Scenario";
import { Interaction, INTERACTION_TABLE, LAST_REPLY_TABLE, Message } from "../types/model";
import { formatDate } from "../utils";

declare module "koishi" {
    interface Context {
        scenario: ScenarioManager;
    }
}

/**
 * Scenario 管理器。
 * 负责 Scenario 实例的生命周期、缓存和增量更新。
 */
export class ScenarioManager extends Service {
    private scenarios: Map<string, Scenario> = new Map();
    constructor(ctx: Context) {
        super(ctx, "scenario", true);
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
     * @param isBotMessage 是否为机器人自身发送的消息（影响已读/未读状态）
     */
    async updateMessage(message: Message, session: Session, isRead: boolean): Promise<void> {
        const scenario = await this.getScenario(session);
        scenario.addContext(message, isRead);
    }

    /**
     * 更新 Scenario 中的交互记录。
     * 当工具调用或结果返回时调用。
     * @param interaction 交互对象
     * @param session 关联的会话
     */
    async updateInteraction(interaction: Interaction, session: Session, isRead: boolean): Promise<void> {
        const scenario = await this.getScenario(session);
        scenario.addContext(interaction, isRead);
    }

    /**
     * 处理交互记录的生命周期：递减 'life' 值并移除过期记录。
     * 此函数在 Koishi LLMChain 处理之前调用，确保上下文中的交互记录是最新的。
     * 优化：使用批处理 SQL 语句。
     * 新增：同步更新内存中 Scenario 实例的 Interaction 生命周期。
     * @param channelId 频道ID
     */
    async processInteractions(channelId: string): Promise<void> {
        let updatedInDbCount = 0;
        let deletedInDbCount = 0;

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
            }
        } catch (error) {}
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

    public render(channels: string[]): string {
        const INDENT_UNIT = "  ";
        const scenarioList = channels
            .map((channel) => {
                const scenario = this.scenarios.get(channel);
                if (!scenario) {
                    this.ctx.logger.warn(`[ScenarioManager] 渲染时找不到频道 ${channel} 的 Scenario 实例。`);
                }
                return scenario;
            })
            .filter((s) => s !== undefined) as Scenario[];

        const active = scenarioList.filter((scenario) => scenario.isActive);
        const inactive = scenarioList.filter((scenario) => !scenario.isActive);
        const contentParts: string[] = [];

        contentParts.push(`<scenario_update timestamp="${formatDate(new Date())}">`);
        if (active.length > 0) {
            active.forEach((scenario) => {
                contentParts.push(scenario.render());
            });
        } else {
            contentParts.push(INDENT_UNIT + `<!-- No active scenarios with new messages -->`);
        }
        contentParts.push(`</scenario_update>`);

        contentParts.push(`<no_activity>`);
        if (inactive.length > 0) {
            inactive.forEach((scenario) => {
                contentParts.push(scenario.render());
            });
        } else {
            contentParts.push(INDENT_UNIT + `<!-- No inactive scenarios to report -->`);
        }
        contentParts.push(`</no_activity>`);

        contentParts.push(`<task_instruction>`);
        contentParts.push(INDENT_UNIT + `请综合以上所有群组的最新动态，决定你希望如何回应。`);
        contentParts.push(INDENT_UNIT + `如果你决定回复，请按照以下格式组织你的回复。对于每个目标群组，生成一个独立的回复内容。`);
        contentParts.push(INDENT_UNIT + `如果你不回复任何群组，请明确指示。`);
        contentParts.push(`</task_instruction>`);
        return contentParts.join("\n");
    }
}
