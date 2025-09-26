import { Schema } from "koishi";
import { ModelDescriptor } from "../model";

/**
 * 多级缓存记忆模型管理配置
 */
export interface HistoryConfig {
    /* === L1 工作记忆 === */
    l1_memory: {
        /** 工作记忆中最多包含的消息数量，超出部分将被平滑裁剪 */
        maxMessages: number;
        /** pending 状态的轮次在多长时间内没有新消息后被强制关闭（秒） */
        pendingTurnTimeoutSec: number;
        /** 保留完整 Agent 响应（思考、行动、观察）的最新轮次数 */
        keepFullTurnCount: number;
    };

    /* === L2 语义索引 === */
    l2_memory: {
        /** 启用 L2 记忆检索 */
        enabled: boolean;
        /** 检索时返回的最大记忆片段数量 */
        retrievalK: number;
        /** 向量相似度搜索的最低置信度阈值，低于此值的结果将被过滤 */
        retrievalMinSimilarity: number;
        /** 每个语义记忆片段包含的消息数量 */
        messagesPerChunk: number;
        /** 是否扩展相邻chunk */
        includeNeighborChunks: boolean;
    };

    /* === L3 长期存档 === */
    l3_memory: {
        /** 启用 L3 日记功能 */
        enabled: boolean;
        useModel?: ModelDescriptor;
        /** 每日生成日记的时间 (HH:mm) */
        diaryGenerationTime: string;
    };
    ignoreSelfMessage: boolean;
    ignoreCommandMessage: boolean;

    /* === 清理 === */
    logLengthLimit?: number;
    dataRetentionDays: number;
    cleanupIntervalSec: number;
}

export const HistoryConfig: Schema<HistoryConfig> = Schema.object({
    l1_memory: Schema.object({
        maxMessages: Schema.number().default(50).description("上下文中最多包含的消息数量"),
        pendingTurnTimeoutSec: Schema.number().default(1800).description("等待处理的交互轮次在多长时间无新消息后被强制关闭（秒）"),
        keepFullTurnCount: Schema.number().default(2).description("保留完整 Agent 响应（思考、行动、观察）的最新轮次数"),
    }),

    l2_memory: Schema.object({
        enabled: Schema.boolean().default(true).description("启用语义记忆检索功能 (RAG)"),
        retrievalK: Schema.number().default(8).description("每次检索的最大记忆片段数量"),
        retrievalMinSimilarity: Schema.number().default(0.55).description("向量相似度搜索的最低置信度阈值，低于此值的结果将被过滤"),
        messagesPerChunk: Schema.number().default(4).description("每个语义记忆片段包含的消息数量"),
        includeNeighborChunks: Schema.boolean().default(true).description("是否扩展前后相邻的记忆片段"),
    }).description("语义索引设置"),

    l3_memory: Schema.object({
        enabled: Schema.boolean().default(false).description("启用长期日记功能"),
        useModel: Schema.dynamic("modelService.selectableModels").description("用于处理记忆的聊天模型"),
        diaryGenerationTime: Schema.string().default("04:00").description("每日生成日记的时间（HH:mm 格式）"),
    })
        .hidden()
        .description("长期存档设置"),

    ignoreSelfMessage: Schema.boolean().default(false).description("是否忽略自身发送的消息"),
    ignoreCommandMessage: Schema.boolean().default(false).description("是否忽略命令消息"),

    logLengthLimit: Schema.number().default(100).description("Agent 内部日志的最大长度"),
    dataRetentionDays: Schema.number().default(30).description("历史数据在被永久删除前的最大保留天数"),
    cleanupIntervalSec: Schema.number().default(1800).description("后台清理任务的执行频率（秒）"),
});
