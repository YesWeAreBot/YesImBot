import { Context, Logger, Service } from "koishi";
import { Services } from "../types"; // 假设 Services 是一个 enum 或 string literal type
import { AdapterSwitchingConfig, LLMAdapterManager } from "./adapter-manager"; // 导入适配器管理器
import { ChatModelSwitcher } from "./chat-model-switcher";
import { IProviderClient, IProviderFactory } from "./factories/base";
import { ChatModel } from "./impl/chat-model";
import { EmbedModel } from "./impl/embed-model";
import { ProviderInstance } from "./impl/provider-instance";
import { LLMRetryManager, RetryConfig } from "./retry-manager"; // 导入重试管理器

// 注册工厂的映射
import { AnthropicFactory } from "./factories/anthropic";
import { OllamaFactory } from "./factories/ollama";
import { OpenAIFactory } from "./factories/openai";
import { ModelDescriptor, ModelServiceConfig } from "./config";
// import { GoogleGeminiFactory } from "./factories/google-gemini"; // 示例

// Koishi 服务注册
declare module "koishi" {
    interface Services {
        [Services.Model]: ModelService;
    }
}

export class ModelService extends Service {
    // 工厂注册表
    private readonly providerFactories = new Map<string, IProviderFactory>();
    // 实例化的 Provider 缓存
    private readonly providerInstances = new Map<string, ProviderInstance>();

    private chatModelSwitcher: ChatModelSwitcher;
    private retryManager: LLMRetryManager;
    private adapterManager: LLMAdapterManager;

    constructor(ctx: Context, public config: ModelServiceConfig) {
        super(ctx, Services.Model, true);

        this.registerFactories();
        this.initializeProviders();

        // 初始化模型切换器、重试管理器和适配器管理器
        this.chatModelSwitcher = new ChatModelSwitcher(ctx, this, this.getEnabledModelDescriptors());
        const retryConfig = {
            maxRetries: 3, // 默认重试次数
            timeoutMs: 30000, // 默认超时时间 30s
            retryDelayMs: 1000, // 默认初始重试延迟 1s
            exponentialBackoff: true, // 默认启用指数退避
            retryableErrors: [
                // 可重试的错误类型/代码
                "ECONNREFUSED",
                "ECONNRESET",
                "ETIMEDOUT",
                "ENOTFOUND",
                "EPIPE",
                "XSAIError",
                "NetworkError",
                "TimeoutError",
                "AbortError",
                // 可以根据具体的 xsai 实现和底层网络库添加更多错误码
            ],
        };
        this.retryManager = new LLMRetryManager(ctx, retryConfig);
        this.adapterManager = new LLMAdapterManager(
            ctx,
            this.chatModelSwitcher,
            { enabled: true, maxAttempts: 3 } // 默认启用适配器切换，最多尝试 3 个适配器
        );
    }

    /**
     * 注册所有支持的 Provider 工厂。
     */
    private registerFactories(): void {
        this.providerFactories.set("OpenAI", new OpenAIFactory());
        this.providerFactories.set("OpenAI Compatible", new OpenAIFactory()); // 复用
        this.providerFactories.set("Ollama", new OllamaFactory());
        this.providerFactories.set("Anthropic", new AnthropicFactory());
        // ... this.providerFactories.set("Google Gemini", new GoogleGeminiFactory());
        // 添加其他 Provider 工厂
    }

    /**
     * 根据配置初始化所有启用的 Provider 实例。
     */
    private initializeProviders(): void {
        if (!this.config.Providers || this.config.Providers.length === 0) {
            this.ctx.logger.warn("未配置任何模型提供商。");
            return;
        }

        for (const providerConfig of this.config.Providers) {
            if (!providerConfig.Enabled) {
                this.ctx.logger.info(`提供商 "${providerConfig.Name}" 已禁用，跳过初始化。`);
                continue;
            }

            const factory = this.providerFactories.get(providerConfig.Type);
            if (!factory) {
                this.ctx.logger.warn(`未找到类型为 "${providerConfig.Type}" 的提供商工厂。跳过提供商 "${providerConfig.Name}"。`);
                continue;
            }

            try {
                // 注意：这里的 client 是 IProviderClient，它包含 chat, embed 等能力
                const client: IProviderClient = factory.createClient(providerConfig);
                const instance = new ProviderInstance(this.ctx, providerConfig, client);
                this.providerInstances.set(instance.name, instance);
                this.ctx.logger.info(`成功初始化提供商: "${instance.name}" (类型: ${providerConfig.Type})`);
            } catch (error) {
                this.ctx.logger.error(`初始化提供商 "${providerConfig.Name}" 时出错:`, error);
            }
        }
    }

    /**
     * 获取所有启用的、包含有效模型的 Provider 的名称列表。
     */
    public getEnabledProviderNames(): string[] {
        return Array.from(this.providerInstances.keys()).filter((name) => this.providerInstances.get(name)?.config.Enabled);
    }

    /**
     * 获取所有启用的模型描述符 (ProviderName, ModelId)。
     */
    public getEnabledModelDescriptors(): ModelDescriptor[] {
        const descriptors: ModelDescriptor[] = [];
        for (const instance of this.providerInstances.values()) {
            if (!instance.config.Enabled) continue;
            for (const modelConfig of instance.config.Models) {
                // TODO: 这里可以根据 Ability 来过滤模型，例如只允许具有聊天能力的模型进入切换器
                // if (modelConfig.Ability & Ability.FunctionCalling) { // 示例：只允许支持 FunctionCalling 的模型
                descriptors.push({ ProviderName: instance.name, ModelId: modelConfig.ModelID });
                // }
            }
        }
        return descriptors;
    }

    // --- LLM 请求相关方法 ---

    /**
     * 获取指定的聊天模型实例。
     * @param providerName - Provider 的唯一名称 (ProviderConfig.Name)。
     * @param modelId - 模型 ID (ModelConfig.ModelID)。
     * @returns ChatModel 实例或 null。
     */
    public getChatModel(providerName: string, modelId: string): ChatModel | null {
        const instance = this.providerInstances.get(providerName);
        if (!instance) {
            this.ctx.logger.warn(`未找到名为 "${providerName}" 的提供商实例。`);
            return null;
        }
        return instance.getChatModel(modelId);
    }

    /**
     * 获取指定的嵌入模型实例。
     * @param providerName - Provider 的唯一名称 (ProviderConfig.Name)。
     * @param modelId - 模型 ID (ModelConfig.ModelID)。
     * @returns EmbedModel 实例或 null。
     */
    public getEmbedModel(providerName: string, modelId: string): EmbedModel | null {
        const instance = this.providerInstances.get(providerName);
        if (!instance) {
            this.ctx.logger.warn(`未找到名为 "${providerName}" 的提供商实例。`);
            return null;
        }
        return instance.getEmbedModel(modelId);
    }

    /**
     * 执行一次聊天请求，自动处理模型切换、重试和超时。
     * @param messages - 对话消息。
     * @param options - 运行时选项，包括模型优先级列表，可覆盖默认的全局配置。
     * @returns 聊天结果。
     */
    public async chat(
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options: {
            modelPriority?: ModelDescriptor[]; // 指定模型切换顺序，否则使用全局配置
            retryConfig?: Partial<RetryConfig>; // 覆盖默认重试配置
            adapterSwitchingConfig?: Partial<AdapterSwitchingConfig>; // 覆盖默认适配器切换配置
            requestTimeoutMs?: number; // 单次请求的超时时间，会传递给 LLMRetryManager
            // ... 其他 ChatModel 需要的选项
        } = {}
    ): Promise<any> {
        // TODO: Define a more specific return type like GenerateTextResult
        const finalModelPriority = options.modelPriority || this.getEnabledModelDescriptors();
        if (finalModelPriority.length === 0) {
            throw new Error("未配置任何可用的聊天模型。");
        }

        // 更新 ChatModelSwitcher 的模型列表，以防在服务启动后配置发生变化
        // NOTE: 如果希望在服务启动后动态更新模型列表，需要添加一个 updateModelPriority 方法
        // 这里简单起见，使用当前的服务实例的switcher
        // this.chatModelSwitcher.updateModelPriority(finalModelPriority);

        // 这里的 adapterManager 会负责调用 modelSwitcher 来获取当前模型
        // retryManager 会被 adapterManager 内部调用来处理单个模型的重试
        const result = await this.adapterManager.executeWithAdapterSwitching(async (adapterName: string, currentModel: ChatModel) => {
            // 这里是 adapterManager 调度的操作，会包含对 model 的调用
            // 将请求的超时配置传递下去
            const effectiveRetryConfig = {
                ...this.retryManager.config, // 默认配置
                ...options.retryConfig, // 用户覆盖的重试配置
                timeoutMs: options.requestTimeoutMs || this.retryManager.config.timeoutMs, // 最终的超时时间
            };
            // 如果 adapterManager 中也需要传递 timeoutMs, 则在此处调整 retryManager 的配置或传递参数
            // 对于当前的实现，timeoutMs 是在 retryManager.executeWithRetry 中直接使用的
            // adapterManager 负责的是切换，retryManager 负责的是重试
            // 假设 adapterManager 通过某种方式能将 timeoutMs 传递给 retryManager 的 operation
            // 或者 retryManager.executeWithRetry 接受 timeoutMs 参数

            // 为 adapterManager 执行的重试操作设置自定义的超时时间
            const operationWithTimeout = async (abortSignal: AbortSignal, cancelTimeout: () => void) => {
                // 这里调用 currentModel.chat
                return await currentModel.chat(messages, {
                    abortSignal: abortSignal,
                    onStreamStart: cancelTimeout, // 流式开始时取消重试定时器
                    // ... 其他传递给 ChatModel 的选项
                    logger: this.ctx.logger("llm"),
                    debug: true, // 假设 debug 开关在此处控制
                });
            };

            return await this.retryManager.executeWithRetry(
                operationWithTimeout,
                adapterName // 用于日志记录
            );
        });
        return result;
    }

    // TODO: 实现 embed 方法，使用 EmbedModel

    /**
     * 获取模型服务配置
     */
    public getModelServiceConfig(): ModelServiceConfig {
        return this.config;
    }

    /**
     * 提供 ChatModelSwitcher 的实例，供其他服务使用（例如中间件）
     */
    public getChatModelSwitcher(): ChatModelSwitcher {
        return this.chatModelSwitcher;
    }

    public getAdapterManager(UseModel: { ProviderName: string; ModelId: string }[]): LLMAdapterManager {
        return new LLMAdapterManager(this.ctx, this.chatModelSwitcher, { enabled: true, maxAttempts: 3 });
    }

    public getRetryManager(Retry: {
        MaxRetries: number;
        TimeoutMs: number;
        RetryDelayMs: number;
        ExponentialBackoff: boolean;
    }): LLMRetryManager {
        return new LLMRetryManager(this.ctx, {
            maxRetries: Retry.MaxRetries,
            timeoutMs: Retry.TimeoutMs,
            retryDelayMs: Retry.RetryDelayMs,
            exponentialBackoff: Retry.ExponentialBackoff,
            retryableErrors: [
                "ECONNREFUSED",
                "ECONNRESET",
                "ETIMEDOUT",
                "ENOTFOUND",
                "EPIPE",
                "XSAIError",
                "NetworkError",
                "TimeoutError",
                "AbortError",
            ],
        });
    }

    // 在服务停止时进行清理
    stop(): void {
        this.ctx.logger.info("ModelService is stopping.");
        // TODO: 释放资源，如 http 客户端连接等
        super.stop();
    }
}
