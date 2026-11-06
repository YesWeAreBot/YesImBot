import { Schema } from "koishi";

/**
 * PromptService 配置接口
 */
export interface PromptServiceConfig {
    /**
     * 在模板中用于注入所有扩展片段的占位符名称。
     * @default 'extensions'
     */
    injectionPlaceholder?: string;
    /**
     * 兼容旧配置；模板只渲染一次，动态数据不再递归解释。
     * @default 3
     */
    maxRenderDepth?: number;
}

export const PromptServiceConfigSchema: Schema<PromptServiceConfig> = Schema.object({
    injectionPlaceholder: Schema.string().default("extensions").description("用于注入所有扩展片段的占位符名称。"),
    maxRenderDepth: Schema.number().default(3).min(1).description("兼容旧版渲染深度配置；动态内容始终只作为数据插入。"),
})
    .collapse()
    .description("模板渲染（高级）");
