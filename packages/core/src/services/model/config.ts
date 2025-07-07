import { readFileSync, unlinkSync } from "fs";
import { Schema } from "koishi";
import path from "path";
import { SystemConfig } from "../../config";
import { isNotEmpty } from "../../shared";

// =================================================================
// 1. 核心与共享类型 (Core & Shared Types)
// =================================================================

/** 定义模型支持的能力 */
export enum ModelAbility {
    Vision = "视觉能力",
    WebSearch = "网络搜索能力",
    Reasoning = "推理能力",
    FunctionCalling = "函数调用能力",
    Embedding = "嵌入能力",
    Chat = "聊天能力",
}

/**
 * @enum TaskType
 * @description 定义了系统中的核心AI任务类型，用于类型安全地分配模型组。
 */
export enum TaskType {
    Chat = "chat",
    Embedding = "embedding",
    Summarization = "summarization",
}

/** 描述一个模型在特定提供商中的位置 */
export type ModelDescriptor = {
    providerName: string;
    modelId: string;
};

// =================================================================
// 2. 配置项 - 按UI逻辑分组
// =================================================================

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

export const ModelConfigSchema: Schema<ModelConfig> = Schema.object({
    modelId: Schema.string().required().description("模型ID"),
    abilities: Schema.array(
        Schema.union([
            ModelAbility.Chat,
            ModelAbility.Vision,
            ModelAbility.WebSearch,
            ModelAbility.Reasoning,
            ModelAbility.FunctionCalling,
            ModelAbility.Embedding,
        ])
    )
        .role("checkbox")
        .default([ModelAbility.Chat, ModelAbility.FunctionCalling])
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

export const PROVIDER_TYPES = [
    "OpenAI",
    "Anthropic",
    "Google Gemini",
    "Ollama",
    "OpenAI Compatible",
    "Fireworks",
    "DeepSeek",
    "LM Studio",
    "Workers AI",
    "Zhipu",
    "Silicon Flow",
    "Qwen",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderConfig {
    name: string;
    enabled?: boolean;
    type: ProviderType;
    baseURL?: string;
    apiKey: string;
    proxy?: string;
    models: ModelConfig[];
}

export const ProviderConfigSchema: Schema<ProviderConfig> = Schema.object({
    name: Schema.string().required().description("提供商名称"),
    enabled: Schema.boolean().default(true).description("是否启用"),
    type: Schema.union(PROVIDER_TYPES).default("OpenAI").description("提供商类型"),
    baseURL: Schema.string().description("提供商的 API 地址"),
    apiKey: Schema.string().role("secret").description("提供商的 API 密钥"),
    proxy: Schema.string().description("代理地址"),
    models: Schema.array(ModelConfigSchema).description("模型列表"),
})
    .collapse()
    .description("提供商配置");

export interface ModelServiceConfig {
    providers: ProviderConfig[];
    modelGroups: Record<string, ModelDescriptor[]>;
    taskAssignments: {
        [TaskType.Chat]: string;
        [TaskType.Embedding]: string;
        [TaskType.Summarization]: string;
    };
    readonly system?: SystemConfig;
}

let selectableModels: Schema<ModelDescriptor>[] = [];

try {
    const models: (ModelDescriptor & { desc: string })[] = JSON.parse(readFileSync(path.resolve(__dirname, "./models.json"), "utf-8"));
    selectableModels = models
        .filter((m) => isNotEmpty(m.modelId) && isNotEmpty(m.providerName))
        .map((m) => {
            return Schema.const({ providerName: m.providerName, modelId: m.modelId }).description(`${m.providerName} - ${m.modelId}`);
        });
} catch (error) {
    console.error("加载模型列表失败，可能是首次启动或文件损坏。");
}

export const ModelServiceConfigSchema: Schema<ModelServiceConfig> = Schema.object({
    providers: Schema.array(ProviderConfigSchema)
        .required()
        .role("table")
        .collapse()
        .description("配置你的 AI 模型提供商，如 OpenAI, Anthropic 等"),
    modelGroups: Schema.dict(Schema.array(Schema.dynamic("modelService.selectableGroup")).role("table").description("此模型组包含的模型"))
        .required()
        .description("创建模型组，用于故障转移或分类。键是组名。"),
    taskAssignments: Schema.object({
        [TaskType.Chat]: Schema.dynamic("modelService.availableGroups").description("主要聊天功能使用的模型组"),
        [TaskType.Embedding]: Schema.dynamic("modelService.availableGroups").description("生成文本嵌入(Embedding)时使用的模型组"),
        [TaskType.Summarization]: Schema.dynamic("modelService.availableGroups").description("对话历史总结时使用的模型组"),
    }).description("为不同核心任务分配一个模型组"),
});
