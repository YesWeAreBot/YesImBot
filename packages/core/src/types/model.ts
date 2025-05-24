import { ToolCallResult } from "../extensions";
import { MemoryBlock } from "../Memory";

// 数据库表名
export const MESSAGE_TABLE = "yesimbot.message"
export const MEMORY_TABLE = "yesimbot.memory_block"
export const INTERACTION_TABLE = "yesimbot.interaction"
export const LAST_REPLY_TABLE = "yesimbot.last_reply"
export const IMAGE_TABLE = "yesimbot.image"

declare module "koishi" {
    interface Tables {
        [MESSAGE_TABLE]: Message;
        [MEMORY_TABLE]: MemoryBlock;
        [INTERACTION_TABLE]: Interaction;
        [LAST_REPLY_TABLE]: {
            channelId: string;
            timestamp: Date;
        };
        [IMAGE_TABLE]: ImageData;
    }
}

export type Message = {
    messageId: string;
    sender: {
        id: string;
        name: string;
        nick: string;
    }
    channel: {
        id: string;
        type: "private" | "guild" | "sandbox";
    }
    timestamp: Date;
    content: string;
};

export type Interaction = {
    id: string;
    emitter: string;  // 由哪条消息触发，为消息ID
    type: "tool_call" | "tool_result" | "message";
    content: ToolCallResult | string;
    life: number;     // 生命周期，为添加到上下文的次数，归零时将被删除，避免浪费token
    timestamp: Date;
};

export interface ImageData {
    id: string;        //
    mimeType: string;  //
    base64?: string;   //
    summary: string;   //
    desc?: string;     // 描述
    size: number;      // 大小
    timestamp: Date;   //
}
