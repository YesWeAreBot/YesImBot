import { Schema } from "koishi";
import { ModelSetting } from "./adapters/config";
import { ToolManagerConfig } from "./extensions";
import { defaultCompressionPrompt } from "./memory/MemoryBlock";
import { ReplyConditionConfig } from "./middleware/CheckReplyCondition";
import { PromptBuilderConfig, SystemBaseTemplate, ToolBaseTemplate, UserBaseTemplate } from "./prompt/PromptBuilder";
import { GroupInfoVisibility, MultimodalConfig } from "./services/scenario/Scenario";

interface BlockConfig {
    Limit?: number;
    FilePathToBind: string;
}

// 主配置接口
export interface Config {
    Memory: {
        Block: Record<string, BlockConfig>;
        UseModel?: [number, number];
        Compression: {
            CompressionWhen?: "Lines" | "Characters" | "IntervalMessages" | "IntervalMinutes";
            Lines?: number; // 按行数阈值触发
            Characters?: number; // 按字符数阈值触发
            IntervalMessages?: number; // 按消息频率触发
            IntervalMinutes?: number; // 按时间间隔触发
            CustomPrompt?: string; // 压缩总结的自定义提示词
            CompressibleBlocks?: string[]; // 例如: ['human', 'context']
        };
        // Extract: {
        //     ExtractWhen?: number;
        //     CustomPrompt?: string;
        // };
        Backup: {
            Enabled: boolean;
            BackupPath: string;
        };
    };
    ReplyCondition: ReplyConditionConfig;
    ModelSetting: ModelSetting;
    Chat: {
        UseModel: [number, number][];
        MaxHeartbeat: number;
        WordsPerSecond: number;
    };
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
    ImageViewer: {
        UseModel?: [number, number];
        CustomPrompt?: string;
    };
    ToolManagerConfig: ToolManagerConfig;
    ToolCall: {
        MaxRetry: number;
        Life: number;
    };
    GroupInfoVisibility: GroupInfoVisibility;
    Task: {};
    Multimodal: MultimodalConfig;
    PromptTemplate: PromptBuilderConfig;
    Debug: {
        EnableDebug: boolean;
        UploadDump: boolean;
    };
}

// 主配置 Schema
export const Config: Schema<Config> = Schema.object({
    ReplyCondition: Schema.object({
        Channels: Schema.array(Schema.array(String).role("table")).description("允许回复的频道列表"),
        TestMode: Schema.boolean().default(false).description("测试模式，每条消息都会触发回复"),

        Strategies: Schema.object({
            AtMention: Schema.object({
                Enabled: Schema.boolean().default(true).description("启用@提及回复策略"),
                Probability: Schema.computed(
                    Schema.number().default(0.8).min(0).max(1).step(0.05).role("slider").description("收到 @ 消息时立即回复的概率（0-1）")
                ),
            }).description("@提及回复策略配置"),

            Threshold: Schema.object({
                Enabled: Schema.boolean().default(true).description("启用阈值回复策略"),
                Value: Schema.number().min(0).max(100).default(50).step(1).role("slider").description("触发回复的意愿阈值"),
            }).description("阈值回复策略配置"),

            ConversationFlow: Schema.object({
                Enabled: Schema.boolean().default(true).description("启用对话流分析策略"),
                ConfidenceThreshold: Schema.number()
                    .min(0)
                    .max(1)
                    .default(0.6)
                    .step(0.05)
                    .role("slider")
                    .description("对话流分析的置信度阈值"),
            }).description("对话流分析策略配置"),
        }).description("回复策略配置"),

        Timing: Schema.object({
            WaitTime: Schema.number().default(3000).min(0).max(10000).description("消息等待时间（毫秒），用于合并用户的连续消息"),
            SameUserThreshold: Schema.number().default(5000).min(0).max(30000).description("判定为同一用户连续消息的时间阈值（毫秒）"),
        }).description("时间控制配置"),

        Advanced: Schema.object({
            Willingness: Schema.object({
                MessageIncrease: Schema.number().default(5).min(0).max(50).description("收到普通消息时增加的意愿值"),
                AtIncrease: Schema.number().default(20).min(0).max(100).description("收到 @ 消息时增加的意愿值"),
                DecayRate: Schema.number().default(2).min(0).max(20).description("意愿值每分钟衰减量"),
                RetentionAfterReply: Schema.number()
                    .default(0.3)
                    .min(0)
                    .max(1)
                    .step(0.1)
                    .role("slider")
                    .description("回复后保留的意愿值比例"),
            }).description("意愿值系统配置"),
        })
            .description("高级功能配置")
            .collapse(),
    }).description("回复条件配置"),

    ModelSetting: ModelSetting.description("模型服务"),
    Chat: Schema.object({
        UseModel: Schema.array(
            Schema.tuple([Schema.number().min(0), Schema.number().min(0)])
                .default([0, 0])
                .description("第几个提供商的第几个模型，从 0 开始计数")
        )
            .required()
            .description("对话使用的模型") as Schema,
        MaxHeartbeat: Schema.number().min(1).max(6).default(2).step(1).role("slider").description("最大心跳次数，控制对话的活跃度"),
        WordsPerSecond: Schema.number().min(0).max(360).default(20).step(1).role("slider").description("模拟打字速度，每秒发送的字符数"),
    }).description("对话行为配置"),

    LLM: Schema.object({
        RetryConfig: Schema.object({
            MaxRetries: Schema.number().min(0).max(10).default(3).description("单个适配器的最大重试次数"),
            TimeoutMs: Schema.number().min(1000).max(300000).default(30000).description("单次请求超时时间（毫秒）"),
            RetryDelayMs: Schema.number().min(100).max(10000).default(1000).description("重试延迟时间（毫秒）"),
            ExponentialBackoff: Schema.boolean().default(true).description("是否使用指数退避策略"),
            RetryableErrors: Schema.array(String).default([
                "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE",
                "XSAIError", "NetworkError", "TimeoutError"
            ]).description("可重试的错误类型"),
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
            // SummaryWhen: Schema.number(),
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
        // Extract: Schema.object({
        //     // ExtractWhen: Schema.number(),
        //     CustomPrompt: Schema.string()
        //         .role("textarea", { rows: [2, 4] })
        //         .description("自定义提示词"),
        // }).description("记忆提取配置"),
        Backup: Schema.object({
            Enabled: Schema.boolean().default(true),
            BackupPath: Schema.string().default("data/yesimbot/memory/.backup"),
        }),
    }).description("记忆设置"),
    // 保留备用。记忆方案：["embedding模型与RAG，结合koishi的database做向量库", "定期发送消息给LLM，总结聊天记录，并塞到后续的请求prompt中", "两者结合，定期发送消息给LLM，总结聊天记录，把总结文本向量化后存入向量库，有请求时把输入向量化和向量库内的总结做比对，提取出相关的总结塞到prompt中"]
    // 向量库的设想：为每个向量添加时间戳，定期检查并删除超过一定时间的向量；记录每个向量的使用频率，删除使用频率低的向量；查询时，提升更近时间存入的向量的权重 // 遗忘机制 & 减少向量库的大小
    // 多模态向量库：图像和文本嵌入模型，需要CLIP等多模态模型支持/文本和图像对齐??
    // 欸以上这些好像mem0都想到了?
    //
    // Memory: Schema.intersect([
    //     Schema.object({
    //         Enabled: Schema.boolean().default(false),
    //     }).description('是否启用记忆中枢'),
    //     Schema.union([
    //         Schema.object({
    //             Enabled: Schema.const(true).required(),
    //             API: Schema.object({
    //                 APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"])
    //                     .default("OpenAI")
    //                     .description("记忆中枢 API 类型"),
    //                 BaseURL: Schema.string()
    //                     .default("https://api.openai.com/")
    //                     .description("记忆中枢 API 基础 URL"),
    //                 UID: Schema.string()
    //                     .default("")
    //                     .description("记忆中枢 Cloudflare UID（如果适用）"),
    //                 APIKey: Schema.string()
    //                     .default("sk-xxxxxxx")
    //                     .description("记忆中枢 API 令牌"),
    //                 AIModel: Schema.string()
    //                     .default("gpt-3.5-turbo")
    //                     .description("记忆中枢使用的模型"),
    //             }).description("记忆中枢 API 配置"),
    //         }),
    //     ])
    // ]),

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

    ToolManagerConfig: Schema.object({
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

    GroupInfoVisibility: Schema.object({
        ShowGroupTitle: Schema.boolean().default(true).description("是否允许 Bot 查看群成员的头衔"),
        ShowChatLevel: Schema.boolean().default(true).description("是否允许 Bot 查看群成员的聊天等级"),
    }).description("群信息可见性设置"),

    Task: Schema.object({}),

    Multimodal: Schema.object({
        Enabled: Schema.boolean().default(false),
        ImageDetail: Schema.union(["low", "high", "auto"]).default("auto"),
        MaxImagesPerPrompt: Schema.number().default(3),
    }).description("多模态设置"),

    PromptTemplate: Schema.object({
        SystemTemplate: Schema.string()
            .default(SystemBaseTemplate)
            .role("textarea", { rows: [4, 8] })
            .description("自定义系统提示词模板"),
        UserTemplate: Schema.string()
            .default(UserBaseTemplate)
            .role("textarea", { rows: [4, 8] })
            .description("自定义用户提示词模板"),
        ToolTemplate: Schema.string()
            .default(ToolBaseTemplate)
            .role("textarea", { rows: [4, 8] })
            .description("自定义工具提示词模板"),
    }).description("自定义提示词"),

    Debug: Schema.object({
        EnableDebug: Schema.boolean().default(false).description("在控制台显示详细的调试信息"),
        UploadDump: Schema.boolean().default(false).description("应用出错时自动上报详细日志给开发者（包含聊天内容和 LLM 输出）"),
    }).description("调试和诊断配置"),
});
