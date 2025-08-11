import { Schema } from "koishi";

import { ChannelDescriptor } from "@/agent";
import { SystemConfig } from "@/config";

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
        /** 记忆片段之间重叠的消息数量，以保持上下文连续性 */
        messageOverlap: number;
    };

    /* === L3 长期存档 === */
    l3_memory: {
        /** 启用 L3 日记功能 */
        enabled: boolean;
        /** 每日生成日记的时间 (HH:mm) */
        diaryGenerationTime: string;
    };

    /* === 清理 === */
    dataRetentionDays: number;
    cleanupIntervalSec: number;

    readonly allowedChannels?: ChannelDescriptor[];
    readonly system?: SystemConfig;
}

export const HistoryConfigSchema: Schema<HistoryConfig> = Schema.object({
    l1_memory: Schema.object({
        maxMessages: Schema.number().default(50).description("L1工作记忆中最多包含的消息数量，超出部分将被平滑裁剪"),
        pendingTurnTimeoutSec: Schema.number().default(1800).description("等待处理的交互轮次在多长时间无新消息后被强制关闭（秒）"),
        keepFullTurnCount: Schema.number().default(2).description("保留完整 Agent 响应（思考、行动、观察）的最新轮次数"),
    }).description("L1 工作记忆设置"),

    l2_memory: Schema.object({
        enabled: Schema.boolean().default(true).description("启用 L2 语义记忆检索功能 (RAG)"),
        retrievalK: Schema.number().default(5).description("每次从 L2 检索的最大记忆片段数量"),
        retrievalMinSimilarity: Schema.number().default(0.7).description("向量相似度搜索的最低置信度阈值，低于此值的结果将被过滤"),
        messagesPerChunk: Schema.number().default(10).description("每个语义记忆片段包含的消息数量。"),
        messageOverlap: Schema.number().default(2).description("记忆片段之间重叠的消息数量，以保持上下文连续性。"),
    }).description("L2 语义索引设置"),

    l3_memory: Schema.object({
        enabled: Schema.boolean().default(true).description("启用 L3 长期日记功能"),
        diaryGenerationTime: Schema.string().default("04:00").description("每日生成日记的时间（HH:mm 格式）"),
    }).description("L3 长期存档设置"),

    dataRetentionDays: Schema.number().default(30).description("历史数据在被永久删除前的最大保留天数"),
    cleanupIntervalSec: Schema.number().default(300).description("后台清理任务的执行频率（秒）"),
});
