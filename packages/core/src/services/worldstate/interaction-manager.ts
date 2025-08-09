import { Services, TableName } from "@/shared/constants";
import { randomUUID } from "crypto";
import { Context, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { AgentTurnData, InteractionData, MessageData } from "./types";

export class InteractionManager {
    private logger: Logger;

    constructor(
        private ctx: Context,
        private config: HistoryConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[交互轮次]");
    }

    /**
     * 获取一个频道的当前待处理轮次。如果没有，则创建一个新的。
     */
    public async getOrCreatePendingTurn(platform: string, channelId: string, guildId?: string): Promise<InteractionData> {
        const pendingTurns = await this.ctx.database.get(
            TableName.Interactions,
            { platform, channelId, status: "pending" },
            { limit: 1, sort: { startTimestamp: "desc" } }
        );

        if (pendingTurns.length > 0) {
            return pendingTurns[0];
        }

        // 没有待处理轮次，创建新的
        const newTurn: InteractionData = {
            id: randomUUID(),
            platform,
            channelId,
            guildId,
            status: "pending",
            startTimestamp: new Date(),
        };
        await this.ctx.database.create(TableName.Interactions, newTurn);
        this.logger.debug(`创建新交互轮次 | ID: ${newTurn.id} | 频道: ${platform}:${channelId}`);
        return newTurn;
    }

    /**
     * 记录一条消息到指定的交互轮次
     */
    public async recordMessage(interactionId: string, message: Omit<MessageData, "interactionId">): Promise<void> {
        try {
            await this.ctx.database.create(TableName.Messages, { ...message, interactionId });
        } catch (error) {
            this.logger.error(`记录消息失败 | 轮次ID: ${interactionId} | 消息ID: ${message.id}`);
            this.logger.debug(error);
        }
    }

    /**
     * 将一个交互轮次标记为“已处理”，并记录 Agent 的响应。
     */
    public async processTurn(interactionId: string, agentTurn: Omit<AgentTurnData, "id" | "interactionId" | "timestamp">): Promise<void> {
        const now = new Date();
        await this.ctx.database.withTransaction(async (db) => {
            await db.set(
                TableName.Interactions,
                { id: interactionId },
                {
                    status: "processed",
                    endTimestamp: now,
                }
            );
            await db.create(TableName.AgentTurns, {
                id: interactionId,
                interactionId: interactionId,
                timestamp: now,
                ...agentTurn,
            });
        });
        this.logger.debug(`交互轮次已处理 | ID: ${interactionId}`);
    }

    /**
     * 定期检查并强制关闭过时的待处理轮次。
     */
    public async checkAndCloseStaleTurns(): Promise<void> {
        const timeout = this.config.l1_memory.pendingTurnTimeoutSec * 1000;
        const cutoffTime = new Date(Date.now() - timeout);

        const staleTurns = await this.ctx.database.get(TableName.Interactions, {
            status: "pending",
            startTimestamp: { $lt: cutoffTime },
        });

        if (staleTurns.length === 0) return;

        const idsToClose = staleTurns.map((turn) => turn.id);
        await this.ctx.database.set(TableName.Interactions, { id: { $in: idsToClose } }, { status: "processed", endTimestamp: new Date() });
        this.logger.info(`强制关闭了 ${idsToClose.length} 个过时的待处理轮次。`);
    }
}
