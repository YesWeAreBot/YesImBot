export enum Ability {
    Vision = 1 << 0, // 视觉
    WebSearch = 1 << 1, // 联网
    Reasoning = 1 << 2, // 推理
    FunctionCalling = 1 << 3, // 工具
    Embedding = 1 << 4, // 嵌入
}

// 模型配置接口，现在包含自己的参数
export interface ModelConfig {
    ModelID: string;
    Ability: number;
    // 模型特定的参数
    Temperature?: number;
    Top_P?: number;
    Stream?: boolean;
    CustomParameters?: { key: string; type: "文本" | "数字" | "布尔值" | "JSON"; value: string }[];
}

// Provider 配置接口，只关心连接
export interface ProviderConfig {
    Name: string; // 新增一个唯一的名称，用于引用
    Enabled?: boolean;
    Type:
        | "OpenAI"
        | "OpenAI Compatible"
        | "Anthropic"
        | "Google Gemini"
        | "OpenRouter"
        | "SiliconFlow"
        | "XAI"
        | "DeepSeek"
        | "Zhipu"
        | "LMStudio"
        | "Ollama"
        | "Qwen"
        | "Cloudflare WorkersAI";
    BaseURL?: string;
    APIKey: string;
    Proxy?: string;
    Models: ModelConfig[];
}

export interface ModelServiceConfig {
    Providers: ProviderConfig[];
    // 将全局设置精简，只保留真正全局的选项
    ToolUseMode: "function" | "prompt";
}

// 使用清晰的描述符
export type ModelDescriptor = { ProviderName: string; ModelId: string };
