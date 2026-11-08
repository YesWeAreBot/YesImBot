import { Schema } from "koishi";

import type { ModelDescriptor } from "../../../model";

export interface CoreUtilConfig {
    deliveryTimeoutMs?: number;
    typing: {
        baseDelay: number;
        charPerSecond: number;
        minDelay: number;
        maxDelay: number;
    };
    vision: {
        timeoutMs?: number;
        allowAuxiliary?: boolean;
        model: ModelDescriptor;
        detail: "low" | "high" | "auto";
    };
}

export const CoreUtilConfigSchema: Schema<CoreUtilConfig> = Schema.object({
    deliveryTimeoutMs: Schema.number().min(0).default(0).description("发送总超时（毫秒），0按分段数、打字延迟与传输预算自动计算"),
    typing: Schema.object({
        baseDelay: Schema.number().default(500).description("基础延迟 (毫秒)"),
        charPerSecond: Schema.number().default(5).description("每秒字符数"),
        minDelay: Schema.number().default(800).description("最小延迟 (毫秒)"),
        maxDelay: Schema.number().default(4000).description("最大延迟 (毫秒)"),
    }),
    vision: Schema.object({
        timeoutMs: Schema.number()
            .min(0)
            .default(0)
            .description("辅助识图总超时（毫秒），0跟随视觉模型的超时、重试预算并预留准备时间；后台执行还受后台任务总上限约束"),
        allowAuxiliary: Schema.boolean().default(false).description("聊天模型已直接接收本图时仍允许辅助识图，适用于较弱的视觉模型"),
        model: Schema.dynamic("modelService.selectableModels").description("用于图片描述的多模态模型"),
        detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
    }),
});
