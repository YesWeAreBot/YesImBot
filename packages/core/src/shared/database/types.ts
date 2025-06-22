import { ToolCallResult } from "../../services";

export interface ChatMessage {
    messageId: string;
    sender: {
        id: string;
        name: string;
        nick?: string;
    };
    channel: {
        id: string;
        type: "private" | "guild" | "sandbox";
    };
    timestamp: Date;
    content: string;
}

export interface Interaction {
    id: string;
    // Interaction 类型，明确区分工具调用和工具结果
    type: "tool_call" | "tool_result";

    // 交互触发相关信息
    emitter: string; // 由哪条消息触发，为消息ID
    emitter_channel_id: string; // 触发此交互的消息所在的频道 ID

    // 工具调用或结果的详细信息
    functionName: string; // 工具函数名称
    toolParams?: Record<string, unknown>; // 如果是 tool_call，保存调用参数
    toolResult?: ToolCallResult; // 如果是 tool_result，保存返回结果

    life: number; // 生命周期，为添加到上下文的次数，归零时将被删除，避免浪费token
    timestamp: Date;
}

export interface ImageData {
    id: string; //
    mimeType: string; //
    base64?: string; //
    summary: string; //
    desc?: string; // 描述
    size: number; // 大小
    timestamp: Date; //
}

export interface MemoryBlockData {
    id: string;
    label: string;
    content: string[];
    limit: number;
}
