import { Schema } from "koishi";

// LLM API 配置接口
export interface LLMConfig {
    Enabled?: boolean;
    Provider: "OpenAI" | "OpenAI Compatible" | "Anthropic" | "Google Gemini" | "OpenRouter" | "SiliconFlow" | "XAI" | "DeepSeek" | "Zhipu" | "LMStudio" | "Ollama" | "Qwen" | "Cloudflare WorkersAI";
    BaseURL?: string;
    UID?: string;
    APIKey: string;
    Model: string;
    Ability?: Array<"原生工具调用" | "识图功能" | "结构化输出" | "流式输出" | "深度思考">;
    TagName?: string;
    StartWithReasoning?: boolean;
    Timeout?: number;
}

// LLM API 参数配置接口
export interface LLMParameters {
    Temperature?: number;
    MaxTokens?: number;
    TopP?: number;
    FrequencyPenalty?: number;
    PresencePenalty?: number;
    Stop?: string | string[];
    OtherParameters?: {
        [key: string]: any;
    };
}

// LLM 配置 Schema
export const LLMConfig: Schema<LLMConfig> = Schema.intersect([
    Schema.object({
        Enabled: Schema.boolean()
            .default(true)
            .description("是否启用此 API 配置"),
        Provider: Schema.union([
            "OpenAI",
            "OpenAI Compatible",
            "Anthropic",
            "Google Gemini",
            "OpenRouter",
            "SiliconFlow",
            "XAI",
            "DeepSeek",
            "Zhipu",
            "LMStudio",
            "Ollama",
            "Qwen",
            "Cloudflare WorkersAI"
        ])
            .default("OpenAI")
            .description("LLM 服务提供商类型"),
        APIKey: Schema.string()
            .role("secret")
            .required()
            .description("API 访问令牌"),
        Model: Schema.string()
            .required()
            .description("要使用的模型 ID"),
        Ability: Schema.array(Schema.union([
            "原生工具调用",
            "识图功能",
            "结构化输出",
            "流式输出",
            "深度思考"
        ]))
            .role("checkbox")
            .experimental()
            .default(["流式输出"])
            .description("模型支持的功能特性。请查阅文档了解各功能的作用。如不确定请保持默认设置"),
        TagName: Schema.string()
            .default("think")
            .description("深度思考功能使用的 XML 标签名称"),
        StartWithReasoning: Schema.boolean()
            .default(false)
            .description("是否在回复中包含模型的思考过程"),
        Timeout: Schema.number()
            .default(60000)
            .min(1000)
            .max(300000)
            .description("API 请求超时时间（毫秒）"),
    }),
    Schema.union([
        Schema.object({
            Provider: Schema.const("OpenAI"),
            BaseURL: Schema.string()
                .default("https://api.openai.com/v1")
                .description("OpenAI API 基础 URL"),
        }),
        Schema.object({
            Provider: Schema.const("OpenAI Compatible"),
            BaseURL: Schema.string()
                .default("https://api.openai.com/v1")
                .description("兼容 OpenAI 格式的 API 基础 URL"),
        }),
        Schema.object({
            Provider: Schema.const("Ollama"),
            BaseURL: Schema.string()
                .default("http://127.0.0.1:11434")
                .description("Ollama 服务地址"),
        }),
        Schema.object({
            Provider: Schema.const("Google Gemini"),
            BaseURL: Schema.string()
                .default("https://generativelanguage.googleapis.com/v1beta/openai/")
                .description("Google Gemini API 基础 URL"),
        }),
        Schema.object({
            Provider: Schema.const("Cloudflare WorkersAI"),
            BaseURL: Schema.string()
                .description("Cloudflare Workers AI API 基础 URL"),
            UID: Schema.string()
                .description("Cloudflare 账户 ID"),
        }),
        Schema.object({
            Provider: Schema.union([
                "Anthropic",
                "OpenRouter",
                "SiliconFlow",
                "XAI",
                "DeepSeek",
                "Zhipu",
                "LMStudio",
                "Qwen"
            ]),
            BaseURL: Schema.string()
                .description("API 基础 URL"),
        }),
    ]),
]);

export const LLMParameters: Schema<LLMParameters> = Schema.object({
    Temperature: Schema.number()
        .default(1.36)
        .min(0)
        .max(2)
        .step(0.01)
        .role("slider")
        .description("采样温度，控制回复的随机性。值越大越随机，值越小越确定"),
    MaxTokens: Schema.number()
        .default(4096)
        .min(1)
        .max(20480)
        .step(1)
        .description("单次生成的最大 Token 数量"),
    TopP: Schema.number()
        .default(0.64)
        .min(0)
        .max(1)
        .step(0.01)
        .role("slider")
        .description("核心采样参数，控制候选词汇的范围。值为1时表示关闭"),
    FrequencyPenalty: Schema.number()
        .default(0)
        .min(-2)
        .max(2)
        .step(0.01)
        .role("slider")
        .description("频率惩罚，降低重复词汇的出现概率"),
    PresencePenalty: Schema.number()
        .default(0)
        .min(-2)
        .max(2)
        .step(0.01)
        .role("slider")
        .description("存在惩罚，鼓励模型讨论新话题"),
    Stop: Schema.union([
        Schema.string().description("单个停止词"),
        Schema.array(Schema.string()).max(4).role("table").description("多个停止词（最多4个）"),
    ])
        .description("自定义停止词，模型遇到这些词时会停止生成"),
    OtherParameters: Schema.dict(
        Schema.string().required(),
        Schema.any().required()
    )
        .default({ do_sample: "true" })
        .role("table")
        .description("其他自定义 API 参数，如 dry_base、response_format 等。如遇到 400/422 错误请尝试清空此项"),
}).description("LLM 生成参数配置")
