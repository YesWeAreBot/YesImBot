import { Schema } from "koishi";
import { SystemConfig } from "../../config";

// =================================================================
// 1. 核心与共享类型 (Core & Shared Types)
// =================================================================

/** 描述一个模型在特定提供商中的位置 */
export type ModelDescriptor = {
    providerName: string;
    modelId: string;
};

/** 定义模型支持的能力 (使用位操作) */
export enum ModelAbility {
    Vision,
    WebSearch,
    Reasoning,
    FunctionCalling,
    Embedding,
}

// =================================================================
// 2. 配置项 - 按UI逻辑分组
// =================================================================

// ------------------- 模块一: 模型服务 (Model Service) - 用户最先关心的部分 -------------------

export interface ModelConfig {
    modelId: string;
    abilities: ModelAbility[];
    parameters?: {
        temperature?: number;
        topP?: number;
        stream?: boolean;
        custom?: { [key: string]: { type: "string" | "number" | "boolean" | "object"; value: any } };
    };
}

export const ModelConfigSchema = Schema.object({
    modelId: Schema.string().required(),
    abilities: Schema.array(
        Schema.union([
            Schema.const(ModelAbility.Vision).description("视觉能力"),
            Schema.const(ModelAbility.WebSearch).description("网络搜索能力"),
            Schema.const(ModelAbility.Reasoning).description("推理能力"),
            Schema.const(ModelAbility.FunctionCalling).description("函数调用能力"),
            Schema.const(ModelAbility.Embedding).description("嵌入能力"),
        ])
    )
        .role("checkbox")
        .default([ModelAbility.FunctionCalling])
        .description("模型支持的能力"),
    parameters: Schema.object({
        temperature: Schema.number().default(1.36),
        topP: Schema.number().default(0.8),
        stream: Schema.boolean().default(true).description("流式传输"),
        custom: Schema.dict(
            Schema.object({
                type: Schema.union(["string", "number", "boolean", "object"]).required(),
                value: Schema.any().required(),
            })
        )
            .role("table")
            .description("自定义参数"),
    }),
})
    .collapse()
    .description("单个模型配置");

export interface ProviderConfig {
    name: string; // 唯一标识符
    enabled?: boolean;
    type: "OpenAI" | "Anthropic" | "Google Gemini" | "Ollama" | "OpenAI Compatible";
    baseURL?: string;
    apiKey: string;
    proxy?: string;
    models: ModelConfig[];
}

export const ProviderConfigSchema = Schema.object({
    name: Schema.string().required().description("提供商名称"),
    enabled: Schema.boolean().default(true).description("是否启用"),
    type: Schema.union(["OpenAI", "Anthropic", "Google Gemini", "Ollama", "OpenAI Compatible"]).default("OpenAI").description("提供商类型"),
    baseURL: Schema.string().description("提供商的 API 地址"),
    apiKey: Schema.string().required().role("secret").description("提供商的 API 密钥"),
    proxy: Schema.string().description("代理地址"),
    models: Schema.array(ModelConfigSchema).description("模型列表"),
})
    .collapse()
    .description("提供商配置");

/**
 * 模型服务总体配置
 * UI 建议:
 * 1. "Providers" 部分让用户添加、编辑、删除提供商列表。
 * 2. "Model Groups" 部分让用户创建新组，并从已启用的 Provider 的模型中拖拽或选择模型加入。
 * 3. "Task Assignments" 部分为每个任务提供一个下拉菜单，选项为上面创建的 Model Groups。
 */
export interface ModelServiceConfig {
    /** 配置你的 AI 模型提供商，如 OpenAI, Anthropic 等 */
    providers: ProviderConfig[];
    /** 创建模型组，用于故障转移或分类。键是组名。 */
    modelGroups: Record<string, ModelDescriptor[]>;
    /** 为不同核心任务分配一个模型组 */
    taskAssignments: {
        /** 主要聊天功能使用的模型组 */
        chat: string;
        /** 生成文本嵌入(Embedding)时使用的模型组 */
        embedding: string;
        /** 对话历史总结时使用的模型组 */
        summarization: string;
    };
    readonly system?: SystemConfig;
}

export const ModelServiceConfigSchema: Schema<ModelServiceConfig> = Schema.object({
    providers: Schema.array(ProviderConfigSchema)
        .required()
        .role("table")
        .collapse()
        .description("配置你的 AI 模型提供商，如 OpenAI, Anthropic 等"),
    modelGroups: Schema.dict(
        Schema.array(
            Schema.object({
                providerName: Schema.string().required().description("提供商名称"),
                modelId: Schema.string().required().description("模型ID"),
            })
        ).role("table")
    )
        .required()
        .description("创建模型组，用于故障转移或分类。键是组名。"),
    taskAssignments: Schema.object({
        chat: Schema.string().required().description("主要聊天功能使用的模型组"),
        embedding: Schema.string().required().description("生成文本嵌入(Embedding)时使用的模型组"),
        summarization: Schema.string().required().description("对话历史总结时使用的模型组"),
    }).description("为不同核心任务分配一个模型组"),
});
