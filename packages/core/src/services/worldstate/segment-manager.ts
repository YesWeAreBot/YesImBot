import { Services, TableName } from "@/shared/constants";
import { randomUUID } from "crypto";
import { Context, Database, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { DialogueSegmentData, MessageData } from "./database-models";
import { AgentResponse, AgentTurn } from "./types";

export class DialogueSegmentManager {
    private ctx: Context;
    private config: HistoryConfig;
    private db: Database;
    private logger: Logger;

    constructor(ctx: Context, config: HistoryConfig) {
        this.ctx = ctx;
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[对话片段]");
    }

    /**
     * 获取一个频道的当前开放片段
     * 如果没有，则创建一个新的
     * 如果有多个，则关闭多余的
     */
    public async getOrCreateOpenSegment(
        platform: string,
        channelId: string,
        guildId?: string
    ): Promise<DialogueSegmentData> {
        const openSegments = await this.ctx.database.get(
            TableName.DialogueSegments,
            { platform, channelId, status: "open" },
            { limit: 10, offset: 0, sort: { startTimestamp: "desc" } }
        );

        if (openSegments.length > 0) {
            // 正常情况，返回最新的一个
            const currentSegment = openSegments.shift();

            // 异常情况：存在多个开放片段，关闭旧的
            if (openSegments.length > 0) {
                const oldSegmentIds = openSegments.map((s) => s.id);
                await this.closeSegments(oldSegmentIds, "redundant");
                /* prettier-ignore */
                this.logger.warn(`发现并关闭了 ${openSegments.length} 个冗余的开放片段 | 频道: ${platform}:${channelId}`);
            }
            return currentSegment;
        }

        // 没有开放片段，创建新的
        const newSegment: DialogueSegmentData = {
            id: randomUUID(),
            platform,
            channelId,
            guildId,
            status: "open",
            startTimestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        this.logger.debug(`创建新片段 | ID: ${newSegment.id} | 频道: ${platform}:${channelId}`);
        return newSegment;
    }

    /**
     * 记录一条消息到指定片段
     */
    public async recordMessage(segmentId: string, message: Omit<MessageData, "sid">): Promise<void> {
        try {
            await this.ctx.database.create(TableName.Messages, { ...message, sid: segmentId });
        } catch (error) {
            this.logger.error(`记录消息失败 | 片段ID: ${segmentId} | 消息ID: ${message.id}`, error);
        }
    }

    /**
     * 由智能体主动关闭片段
     */
    public async closeSegmentByAgent(sid: string, responses: AgentResponse[]): Promise<void> {
        const agentTurn: AgentTurn = { responses, timestamp: new Date() };
        await this.ctx.database.set(
            TableName.DialogueSegments,
            { id: sid },
            { status: "closed", agentTurn, endTimestamp: new Date() }
        );
        this.logger.debug(`片段已由Agent关闭 | ID: ${sid}`);
    }

    /**
     * 定期检查并关闭满足条件的开放片段
     */
    public async checkAndCloseOpenSegments(): Promise<void> {
        const openSegments = await this.ctx.database.get(TableName.DialogueSegments, { status: "open" });

        if (openSegments.length === 0) {
            this.logger.debug("没有需要检查的开放片段");
            return;
        }

        const segmentsToCloseByMaxMessages: string[] = [];
        const segmentsToCloseByInactivity: string[] = [];
        const halfMaxMessages = this.config.maxMessages / 2;

        for (const segment of openSegments) {
            const messages = await this.ctx.database.get(
                TableName.Messages,
                { sid: segment.id },
                {
                    sort: { timestamp: "desc" },
                    fields: ["timestamp"], // 只需要时间戳来判断，更高效
                }
            );
            const messageCount = messages.length;

            // 条件 1: 达到最大消息数量
            if (messageCount >= this.config.maxMessages) {
                segmentsToCloseByMaxMessages.push(segment.id);
                continue; // 已满足关闭条件，跳过后续检查
            }

            // 条件 2: 一段时间内没有新消息
            if (messageCount > halfMaxMessages && messages.length > 0) {
                const lastMessageTime = messages[0].timestamp.getTime();
                const now = Date.now();
                if (now - lastMessageTime > this.config.inactivityTimeoutSec) {
                    segmentsToCloseByInactivity.push(segment.id);
                }
            }
        }

        if (segmentsToCloseByMaxMessages.length > 0) {
            await this.closeSegments(segmentsToCloseByMaxMessages, "max_messages");
            this.logger.debug(`关闭了 ${segmentsToCloseByMaxMessages.length} 个达到消息上限的片段`);
        }

        if (segmentsToCloseByInactivity.length > 0) {
            await this.closeSegments(segmentsToCloseByInactivity, "inactivity");
            this.logger.debug(`关闭了 ${segmentsToCloseByInactivity.length} 个因不活跃而超时的片段`);
        }
    }

    /**
     * 内部辅助方法：批量关闭片段
     * @param segmentIds 要关闭的片段ID数组
     * @param reason 关闭原因 (用于日志)
     */
    /* prettier-ignore */
    private async closeSegments(segmentIds: string[], reason: "redundant" | "max_messages" | "inactivity"): Promise<void> {
        if (segmentIds.length === 0) return;
        await this.ctx.database.set(
            TableName.DialogueSegments,
            { id: { $in: segmentIds } },
            { status: "closed", endTimestamp: new Date() }
        );
        // 注意：关闭片段后，可能也需要触发折叠策略
        // 为简化，这里暂时不处理，可以在 WorldStateService 中调用
    }
}
