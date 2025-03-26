import { Context } from "koishi";

import { ChatMessage } from "../models/ChatMessage";

export const DATABASE_NAME = "yesimbot.message";

declare module "koishi" {
    interface Tables {
        [DATABASE_NAME]: ChatMessage;
    }
}

export function initDatabase(ctx: Context) {
    ctx.model.extend(DATABASE_NAME, {
        sender: "object",
        messageId: "string",
        channelId: "string",
        channelType: "string",
        sendTime: "timestamp",
        content: "string",
        quote: "string",
        raw: {
          type: "string",
          nullable: true,
          initial: null,
        },
    }, {
        primary: "messageId", // 主键名
        autoInc: false,       // 不使用自增主键
    });
}
