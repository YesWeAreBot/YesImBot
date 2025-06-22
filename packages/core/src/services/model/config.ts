import { Schema } from "koishi";
import { Ability, ModelConfig, ModelServiceConfig, ProviderConfig } from "./types";

export const ModelConfigSchema: Schema<ModelConfig> = Schema.object({
    ModelID: Schema.string().required().description("模型 ID"),
    Ability: Schema.bitset(Ability).default(Ability.FunctionCalling).description("选择模型类型"),
    Temperature: Schema.number()
        .min(0)
        .max(2)
        .default(1.36)
        .role("slider")
        .step(0.01)
        .description(
            "模型温度 | 模型生成文本的随机程度。值越大，回复内容越赋有多样性、创造性、随机性；设为 0 根据事实回答。日常聊天建议设置为 0.7"
        ),
    Top_P: Schema.number()
        .min(0)
        .max(1)
        .default(0.95)
        .role("slider")
        .step(0.01)
        .description("Top-p 采样参数，控制生成文本的多样性"),
    Stream: Schema.boolean().default(true).description("是否启用流式输出"),
    CustomParameters: Schema.array(
        Schema.object({
            key: Schema.string().required().description("参数名"),
            type: Schema.union(["文本", "数字", "布尔值", "JSON"]).default("文本").description("参数类型"),
            value: Schema.string().required().description("参数值"),
        })
    )
        .description("自定义参数")
        .collapse(),
}).description("模型配置");

export const ProviderConfigSchema: Schema<ProviderConfig> = Schema.object({
    Name: Schema.string().required().description("提供商的唯一名称，如 'my-openai'"),
    Enabled: Schema.boolean().default(true).description("是否启用"),
    Type: Schema.union([
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
        "Cloudflare WorkersAI",
    ])
        .default("OpenAI")
        .description("提供商类型"),
    BaseURL: Schema.string().default("https://api.openai.com/v1").description("API 地址"),
    APIKey: Schema.string().required().role("secret").description("API 密钥"),
    Models: Schema.array(ModelConfigSchema).description("该提供商下的模型列表"),
    Proxy: Schema.string()
        .pattern(
            /^(?:(http[s]?|socks[45]|ftp|ssh):\/\/)?(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])|localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}|[a-zA-Z0-9-]{1,63}\):(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9]\d{0,3})$/i
        )
        .description("代理地址"),
}).collapse(true);

export const ModelServiceConfigSchema: Schema<ModelServiceConfig> = Schema.object({
    Providers: Schema.array(ProviderConfigSchema).description("模型提供商列表"),
    ToolUseMode: Schema.union(["function", "prompt"]).default("function").description("工具调用模式"),
}).description("模型服务配置");
