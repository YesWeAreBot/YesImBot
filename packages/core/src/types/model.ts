import { Agent } from "../agent";
import { ToolCallResult } from "../extensions";
import { MemoryBlock } from "../Memory";

declare module "koishi" {
    interface Tables {
        [Agent.MESSAGE_TABLE]: Message;
        [Agent.MEMORY_TABLE]: MemoryBlock;
        [Agent.INTERACTION_TABLE]: Interaction;
        [Agent.LAST_REPLY_TABLE]: {
            channelId: string;
            timestamp: Date;
        };
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