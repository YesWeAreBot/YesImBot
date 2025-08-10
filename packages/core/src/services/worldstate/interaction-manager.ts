import { Services, TableName } from "@/shared/constants";
import { Context, h, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { AgentTurnData, MessageData, SystemEventData, L1HistoryItem, ContextualSystemEvent } from "./types";

/**
 * L1 工作记忆管理器
 * 负责将所有类型的事件（消息、Agent 回合、系统事件）持久化到数据库，
 * 并提供按时间顺序检索这些事件以构建线性历史记录的方法。
 */
export class InteractionManager {
    private logger: Logger;

    constructor(
        private ctx: Context,
        private config: HistoryConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[L1 记忆]");
    }

    /**
     * 记录一条消息到数据库。
     */
    public async recordMessage(message: MessageData): Promise<void> {
        try {
            await this.ctx.database.create(TableName.Messages, message);
        } catch (error) {
            this.logger.error(`记录消息失败 | 消息ID: ${message.id}`);
            this.logger.debug(error);
        }
    }

    /**
     * 记录一个 Agent 响应回合到数据库。
     */
    public async recordAgentTurn(agentTurn: AgentTurnData): Promise<void> {
        try {
            await this.ctx.database.create(TableName.AgentTurns, agentTurn);
        } catch (error) {
            this.logger.error(`记录 Agent 回合失败 | ID: ${agentTurn.id}`);
            this.logger.debug(error);
        }
    }

    /**
     * 记录一个系统事件到数据库。
     */
    public async recordSystemEvent(event: SystemEventData): Promise<void> {
        try {
            await this.ctx.database.create(TableName.SystemEvents, event);
        } catch (error) {
            this.logger.error(`记录系统事件失败 | ID: ${event.id}`);
            this.logger.debug(error);
        }
    }

    /**
     * 获取指定频道的 L1 线性历史记录。
     * @param channelId 频道 ID
     * @param limit 检索的事件数量上限
     * @returns 按时间升序排列的事件数组
     */
    public async getL1History(channelId: string, limit: number): Promise<L1HistoryItem[]> {
        const [messages, agentTurns, systemEvents] = await Promise.all([
            this.ctx.database.get(TableName.Messages, { channelId }, { limit, sort: { timestamp: "desc" } }),
            this.ctx.database.get(TableName.AgentTurns, { channelId }, { limit, sort: { timestamp: "desc" } }),
            this.ctx.database.get(TableName.SystemEvents, { channelId }, { limit, sort: { timestamp: "desc" } }),
        ]);

        const combinedEvents: L1HistoryItem[] = [
            ...messages.map(
                (m): L1HistoryItem => ({
                    type: "message",
                    id: m.id,
                    sender: m.sender,
                    content: m.content,
                    elements: h.parse(m.content),
                    timestamp: m.timestamp,
                    quoteId: m.quoteId,
                })
            ),
            ...agentTurns.map(
                (a): L1HistoryItem => ({
                    type: "agent_turn",
                    timestamp: a.timestamp,
                    thoughts: a.thoughts,
                    actions: a.actions,
                    observations: a.observations,
                })
            ),
            ...systemEvents.map(
                (s): L1HistoryItem => ({
                    type: "system_event",
                    id: s.id,
                    eventType: s.type,
                    message: s.renderedMessage,
                    timestamp: s.timestamp,
                })
            ),
        ];

        // 按时间戳升序排序
        combinedEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // 应用最终的数量限制
        const history = combinedEvents.slice(-limit);

        return history;
    }
}
