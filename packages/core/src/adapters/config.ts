import { Schema } from "koishi";

export interface LLMConfig {
    Enabled?: boolean;
    APIType: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL" | "Gemini";
    BaseURL: string;
    UID?: string;
    APIKey: string;
    AIModel: string;
    Ability?: Array<"原生工具调用" | "识图功能" | "结构化输出" | "流式输出" | "深度思考">;
    TagName?: string;
    StartWithReasoning?: boolean;
    Timeout?: number;
}

export interface Config {
    APIList: LLMConfig[];
    Parameters: {
        Temperature?: number;
        MaxTokens?: number;
        TopP?: number;
        FrequencyPenalty?: number;
        PresencePenalty?: number;
        Stop?: string | string[];
        OtherParameters?: {
            [key: string]: string;
        }
    };
}

export const LLMConfig: Schema<LLMConfig> = Schema.intersect([
    Schema.object({
        Enabled: Schema.boolean().default(true).description("是否启用"),
        APIType: Schema.union(["OpenAI", "Cloudflare", "Ollama", "Custom URL", "Gemini"])
            .default("OpenAI")
            .description("API 类型"),
        APIKey: Schema.string().role("secret").required().description("你的 API 令牌"),
        AIModel: Schema.string()
            .description("模型 ID"),
        Ability: Schema.array(Schema.union(["原生工具调用", "识图功能", "结构化输出", "流式输出", "深度思考"]))
            .role("checkbox")
            .experimental()
            .default([])
            .description("模型支持的功能。<br/>请查阅[文档](https://github.com/HydroGest/AthenaDocsNG/blob/main/docs/user-guide/configuration/main-api.md)了解其作用。如果你不知道这是什么，请不要勾选。"),
        TagName: Schema.string().default("think").description("深度思考标签"),
        StartWithReasoning: Schema.boolean().default(false).description("是否在回复中包含思考内容"),
        Timeout: Schema.number().default(60000).description("API请求超时时间（毫秒）"),
    }),
    Schema.union([
        Schema.object({
            APIType: Schema.const("OpenAI"),
            BaseURL: Schema.string().default("https://api.openai.com"),
        }),
        Schema.object({
            APIType: Schema.const("Cloudflare"),
            BaseURL: Schema.string().default("https://api.cloudflare.com/client/v4"),
            UID: Schema.string().required().description("Cloudflare UID"),
        }),
        Schema.object({
            APIType: Schema.const("Custom URL"),
            BaseURL: Schema.string().required().description("填写完整的 API 地址"),
        }),
        Schema.object({
            APIType: Schema.const("Ollama"),
            BaseURL: Schema.string().default("http://127.0.0.1:11434"),
        }),
        Schema.object({
            APIType: Schema.const("Gemini"),
            BaseURL: Schema.string().default("https://generativelanguage.googleapis.com"),
        }),
    ]),
]);

export const Config: Schema<Config> = Schema.object({
    APIList: Schema.array(LLMConfig).description("单个 LLM API 配置，可配置多个 API 进行负载均衡。"),
    Parameters: Schema.object({
        Temperature: Schema.number()
            .default(1.36)
            .min(0)
            .max(2)
            .step(0.01)
            .role("slider")
            .description("采样器的温度。数值越大，回复越随机；数值越小，回复越确定"),
        MaxTokens: Schema.number()
            .default(4096)
            .min(1)
            .max(20480)
            .step(1)
            .description("一次生成的最大 Token 数量。更大的 Token 数量可能会导致生成更长的回复"),
        TopP: Schema.number()
            .default(0.64)
            .min(0)
            .max(1)
            .step(0.01)
            .role("slider")
            .description("核心采样。模型生成的所有候选 Tokens 按照其概率从高到低排序后，依次累加这些概率，直到达到或超过此预设的阈值，剩余的 Tokens 会被丢弃。值为1时表示关闭"),
        FrequencyPenalty: Schema.number()
            .default(0)
            .min(-2)
            .max(2)
            .step(0.01)
            .role("slider")
            .description("数值为正时，会根据 Token 在前文出现的频率进行惩罚，降低模型反复重复同一个词的概率。这是一个乘数"),
        PresencePenalty: Schema.number()
            .default(0)
            .min(-2)
            .max(2)
            .step(0.01)
            .role("slider")
            .description("数值为正时，如果 Token 在前文出现过，就对其进行惩罚，降低它再次出现的概率，提高模型谈论新话题的可能性。这是一个加数"),
        Stop: Schema.union([
            Schema.string().description("单例模式"),
            Schema.array(Schema.string()).max(4).role("table").description("数组模式"),
        ])
            .description("自定义停止词。对于 OpenAI 官方的 API，最多可以设置4个自定义停止词。生成会在遇到这些停止词时停止")
            .default(["<|endoftext|>"]),
        OtherParameters: Schema.dict(
            Schema.string().required(),
            Schema.any().required()
        )
            .default({ do_sample: "true", })
            .role("table")
            .description(
                `自定义请求体中的其他参数。有些api可能包含一些特别有用的功能，例如 dry_base 和 response_format。<br/>
        如果在调用api时出现400或422错误，请尝试删除此处的自定义参数。<br/>
        提示：直接将gbnf内容作为grammar_string的值粘贴至此时，换行符会被转换成空格，需要手动替换为\\n后方可生效`.trim()
            ),
    }).description("API 参数"),
}).description("LLM API 相关配置");
