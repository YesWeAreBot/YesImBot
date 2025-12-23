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
     * 模板渲染的最大深度，用于支持片段的二次渲染，同时防止无限循环。
     * @default 3
     */
    maxRenderDepth?: number;
}

export const PromptServiceConfig: Schema<PromptServiceConfig> = Schema.object({
    injectionPlaceholder: Schema.string().default("extensions").description("用于注入所有扩展片段的占位符名称。"),
    maxRenderDepth: Schema.number().default(3).min(1).description("模板渲染的最大深度，用于支持二次渲染并防止无限循环。"),
}).hidden();

export interface PromptFormatConfig {
    promptFormat: "json" | "toon";
}

export const PromptFormatConfig: Schema<PromptFormatConfig> = Schema.object({
    promptFormat: Schema.union([
        Schema.const("json").description("JSON 格式"),
        Schema.const("toon").description("Toon 格式"),
    ]).default("json").description("提示词输出格式<br/>注意：若切换将会清理上下文（记忆）<br/>请谨慎操作！"),
});
