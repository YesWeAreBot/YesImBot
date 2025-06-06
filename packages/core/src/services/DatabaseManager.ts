import { Context } from "koishi";
import { IMAGE_TABLE, INTERACTION_TABLE, LAST_REPLY_TABLE, MESSAGE_TABLE } from "../types/model";

/**
 * 数据库管理器
 * 负责所有数据库表的注册和初始化
 */
export class DatabaseManager {
    constructor(private ctx: Context) {}

    /**
     * 注册所有数据库表
     */
    public registerTables(): void {
        this.registerMessageTable();
        this.registerInteractionTable();
        this.registerLastReplyTable();
        this.registerImageTable();

        this.ctx.logger.info("[DatabaseManager] 所有数据库表注册完成");
    }

    private registerMessageTable(): void {
        this.ctx.model.extend(
            MESSAGE_TABLE,
            {
                messageId: "string",
                sender: "object",
                channel: "object",
                timestamp: "timestamp",
                content: "string",
            },
            {
                primary: ["messageId"],
                autoInc: false,
            }
        );
    }

    private registerInteractionTable(): void {
        this.ctx.model.extend(
            INTERACTION_TABLE,
            {
                id: "string",
                emitter: "string",
                emitter_channel_id: "string",
                type: "string",
                functionName: "string",
                toolParams: "json",
                toolResult: "object",
                life: "integer",
                timestamp: "timestamp",
            },
            {
                primary: "id",
            }
        );
    }

    private registerLastReplyTable(): void {
        this.ctx.model.extend(
            LAST_REPLY_TABLE,
            {
                channelId: "string",
                timestamp: "timestamp",
            },
            {
                primary: "channelId",
                autoInc: false,
            }
        );
    }

    private registerImageTable(): void {
        this.ctx.model.extend(
            IMAGE_TABLE,
            {
                id: "string",
                mimeType: "string",
                base64: "string",
                summary: "string",
                desc: "string",
                size: "integer",
                timestamp: "timestamp",
            },
            {
                primary: "id",
                autoInc: false,
            }
        );
    }
}
