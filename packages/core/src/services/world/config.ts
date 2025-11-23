import { Schema } from "koishi";

export interface HistoryConfig {
    maxMessages: number;
    ignoreSelfMessage?: boolean;
}

export const HistoryConfig: Schema<HistoryConfig> = Schema.object({
    maxMessages: Schema.number().default(50).description("在构建事件历史时最多检索的消息数量。"),
    ignoreSelfMessage: Schema.boolean().default(true).description("是否忽略由智能体自身发送的消息。"),
});
