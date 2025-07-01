import { Schema } from "koishi";

import { AgentConfig, AgentConfigSchema } from "./agent/config";
import {
    defaultCompressionPrompt,
    MemoryServiceConfig,
    ModelServiceConfig,
    ModelServiceConfigSchema,
    PlatformServiceConfig,
    PlatformServiceConfigSchema,
    ToolServiceConfig,
    WorldStateConfig,
    WorldStateConfigSchema,
} from "./services";

export interface Config {
    Agent: AgentConfig;
    ModelService: ModelServiceConfig;
    Platform: PlatformServiceConfig;
    Memory: MemoryServiceConfig;
    ToolService: ToolServiceConfig;
    WorldState: WorldStateConfig;
    Debug: {
        EnableDebug: boolean;
        UploadDump: boolean;
    };
}

export const Config: Schema<Config> = Schema.object({
    Agent: AgentConfigSchema.description("Agent 配置"),

    ModelService: ModelServiceConfigSchema.description("模型服务"),

    Platform: PlatformServiceConfigSchema,

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

    ToolService: Schema.object({
        MaxRetry: Schema.number().min(0).default(3).description("工具调用最大重试次数"),
        RetryDelayMs: Schema.number().min(0).default(1000).description("工具调用重试延迟时间（毫秒）"),
        AutoLoad: Schema.boolean().default(true),
        ExtensionPaths: Schema.array(String).default([]),
        LogLevel: Schema.union(["debug", "info", "warn", "error"]).default("info"),
        Timeout: Schema.number().default(30000),
        HotReload: Schema.boolean().default(true),
        ValidateTypes: Schema.boolean().default(true),
    }),

    WorldState: WorldStateConfigSchema,

    Debug: Schema.object({
        EnableDebug: Schema.boolean().default(false).description("在控制台显示详细的调试信息"),
        UploadDump: Schema.boolean().default(false).description("应用出错时自动上报详细日志给开发者（包含聊天内容和 LLM 输出）"),
    }).description("调试和诊断配置"),
});
