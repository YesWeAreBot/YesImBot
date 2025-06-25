import { Schema } from "koishi";

import { AgentConfig } from "./agent/config";
import { SystemBaseTemplate, UserBaseTemplate } from "./agent/prompt-builder";
import {
    defaultCompressionPrompt,
    MemoryServiceConfig,
    ModelDescriptor,
    ModelServiceConfig,
    ModelServiceConfigSchema,
    PlatformServiceConfig,
    PlatformServiceConfigSchema,
    ToolServiceConfig,
    WorldStateConfig,
    WorldStateConfigSchema,
} from "./services";
import { PromptBuilderConfig } from "./shared";

export interface ChatConfig {
    UseModel: ModelDescriptor[];
    MaxHeartbeat: number;
    WordsPerSecond: number;
}

export interface Config {
    Agent: AgentConfig;
    ModelService: ModelServiceConfig;
    Platform: PlatformServiceConfig;
    Chat: ChatConfig;
    LLM: {
        RetryConfig: {
            MaxRetries: number;
            TimeoutMs: number;
            RetryDelayMs: number;
            ExponentialBackoff: boolean;
            RetryableErrors: string[];
        };
        AdapterSwitching: {
            Enabled: boolean;
            MaxAttempts: number;
        };
    };
    Memory: MemoryServiceConfig;
    ImageViewer: {
        UseModel?: [number, number];
        CustomPrompt?: string;
    };
    // Multimodal: MultimodalConfig;
    ToolService: ToolServiceConfig;
    ToolCall: {
        MaxRetry: number;
        Life: number;
    };
    // GroupInfoVisibility: GroupInfoVisibility;
    Task: {};
    PromptTemplate: PromptBuilderConfig;
    WorldState: WorldStateConfig;
    Debug: {
        EnableDebug: boolean;
        UploadDump: boolean;
    };
}

export const ChatConfigSchema: Schema<ChatConfig> = Schema.object({
    UseModel: Schema.array(
        Schema.object({
            ProviderName: Schema.string().description("提供商名称"),
            ModelId: Schema.string().description("模型ID"),
        })
    )
        .role("table")
        .required()
        .description("对话使用的模型"),
    MaxHeartbeat: Schema.number().min(1).max(6).default(2).step(1).role("slider").description("最大心跳次数，控制对话的活跃度"),
    WordsPerSecond: Schema.number().min(0).max(360).default(20).step(1).role("slider").description("模拟打字速度，每秒发送的字符数"),
}).description("对话行为配置");

export const Config: Schema<Config> = Schema.object({
    Agent: AgentConfig.description("Agent 配置"),
    ModelService: ModelServiceConfigSchema.description("模型服务"),

    Chat: ChatConfigSchema,

    Platform: PlatformServiceConfigSchema,

    LLM: Schema.object({
        RetryConfig: Schema.object({
            MaxRetries: Schema.number().min(0).max(10).default(3).description("单个适配器的最大重试次数"),
            TimeoutMs: Schema.number().min(1000).max(300000).default(30000).description("单次请求超时时间（毫秒）"),
            RetryDelayMs: Schema.number().min(100).max(10000).default(1000).description("重试延迟时间（毫秒）"),
            ExponentialBackoff: Schema.boolean().default(true).description("是否使用指数退避策略"),
            RetryableErrors: Schema.array(String)
                .default(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE", "XSAIError", "NetworkError", "TimeoutError"])
                .description("可重试的错误类型")
                .collapse(true),
        }).description("重试配置"),
        AdapterSwitching: Schema.object({
            Enabled: Schema.boolean().default(true).description("是否启用适配器自动切换"),
            MaxAttempts: Schema.number().min(1).max(10).default(3).description("适配器切换的最大尝试次数"),
        }).description("适配器切换配置"),
    }).description("LLM处理配置"),

    Memory: Schema.object({
        Block: Schema.dict(
            Schema.object({
                Limit: Schema.number().min(0).default(5000).description("长度限制"),
                FilePathToBind: Schema.path({
                    allowCreate: true,
                    filters: ["directory", { name: "text", extensions: ["txt"] }],
                })
                    .required()
                    .description("文件路径"),
            }).description("记忆类型")
        )
            .role("table")
            .default({
                human: { Limit: 5000, FilePathToBind: "data/yesimbot/memory/human.txt" },
                persona: { Limit: 2000, FilePathToBind: "data/yesimbot/memory/persona.txt" },
            })
            .description("记忆文件存储路径配置，键为记忆类型，值为文件路径"),
        UseModel: Schema.tuple([Number, Number]).default([0, 0]).description("压缩记忆使用的模型") as Schema,
        Compression: Schema.object({
            Lines: Schema.number().min(0).default(500).description("记忆块内容超过多少行时触发压缩汇总 (0为禁用)"),
            Characters: Schema.number().min(0).default(20000).description("记忆块内容超过多少字符时触发压缩汇总 (0为禁用)"),
            IntervalMessages: Schema.number().min(0).default(0).description("每追加多少条消息后触发压缩汇总 (0为禁用)"),
            IntervalMinutes: Schema.number().min(0).default(0).description("每间隔多少分钟后触发压缩汇总 (0为禁用)"),
            CompressibleBlocks: Schema.array(String).default(["human"]).description("哪些 core memory block 启用压缩"),
            CustomPrompt: Schema.string()
                .default(defaultCompressionPrompt)
                .role("textarea", { rows: [2, 4] })
                .description("自定义提示词"),
        }).description("记忆压缩配置"),
        Backup: Schema.object({
            Enabled: Schema.boolean().default(true),
            BackupPath: Schema.string().default("data/yesimbot/memory/.backup"),
        }),
    }).description("记忆设置"),

    ImageViewer: Schema.object({
        UseModel: Schema.tuple([Number, Number]).default([0, 0]).description("解析图片使用的模型") as Schema,
        CustomPrompt: Schema.string()
            .default(
                `你是一个图像分析专家。请根据以下指令，详细分析提供的图片。
请提供图片主要内容、场景、主要物体和人物的详细描述，力求准确、客观和全面。
请直接输出分析结果，无需额外寒暄。避免提及你无法直接看到图片。你的回答应该简洁、信息丰富且直接回应指令。`
            )
            .role("textarea", { rows: [2, 4] })
            .description("自定义提示词"),
    }).description("识图设置"),

    // Multimodal: Schema.object({
    //     Enabled: Schema.boolean().default(false),
    //     ImageDetail: Schema.union(["low", "high", "auto"]).default("auto"),
    //     MaxImagesPerPrompt: Schema.number().default(3),
    // }).description("多模态设置"),

    ToolService: Schema.object({
        autoLoad: Schema.boolean().default(true),
        extensionPaths: Schema.array(String).default([]),
        logLevel: Schema.union(["debug", "info", "warn", "error"]).default("info"),
        timeout: Schema.number().default(30000),
        hotReload: Schema.boolean().default(true),
        validateTypes: Schema.boolean().default(true),
    }),

    ToolCall: Schema.object({
        MaxRetry: Schema.number().default(3).min(0).max(10).description("工具调用失败时的最大重试次数"),
        Life: Schema.number().default(3).min(0).max(10).description("工具调用的生命周期次数"),
    }).description("工具调用管理配置"),

    // GroupInfoVisibility: Schema.object({
    //     ShowGroupTitle: Schema.boolean().default(true).description("是否允许 Bot 查看群成员的头衔"),
    //     ShowChatLevel: Schema.boolean().default(true).description("是否允许 Bot 查看群成员的聊天等级"),
    //     ShowRole: Schema.boolean().default(true).description("是否允许 Bot 查看群成员的群组身份"),
    // }).description("群信息可见性设置"),

    Task: Schema.object({}),

    PromptTemplate: Schema.object({
        SystemTemplate: Schema.string()
            .default(SystemBaseTemplate)
            .role("textarea", { rows: [4, 8] })
            .description("自定义系统提示词模板"),
        UserTemplate: Schema.string()
            .default(UserBaseTemplate)
            .role("textarea", { rows: [4, 8] })
            .description("自定义用户提示词模板"),
    }).description("自定义提示词"),

    WorldState: WorldStateConfigSchema,

    Debug: Schema.object({
        EnableDebug: Schema.boolean().default(false).description("在控制台显示详细的调试信息"),
        UploadDump: Schema.boolean().default(false).description("应用出错时自动上报详细日志给开发者（包含聊天内容和 LLM 输出）"),
    }).description("调试和诊断配置"),
});
