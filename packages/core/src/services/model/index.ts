import { Context, Service } from "koishi";

// 工厂相关
import { Services } from "../types";
import { AnthropicFactory } from "./factories/anthropic";
import { IProviderFactory } from "./factories/base";
import { OllamaFactory } from "./factories/ollama";
import { OpenAIFactory } from "./factories/openai";
import { ChatModel } from "./impl/ChatModel";
import { EmbedModel } from "./impl/EmbedModel";
import { ProviderInstance } from "./impl/ProviderInstance";
import { ModelDescriptor, ModelServiceConfig } from "./types";

// 导出配置和类型
export * from "./config";
export * from "./impl/ChatModel";
export * from "./impl/EmbedModel";
export * from "./impl/ProviderInstance";
export * from "./types";

export class ModelService extends Service {
    // 工厂注册表
    private readonly providerFactories = new Map<string, IProviderFactory>();
    // 实例化的 Provider 缓存
    private readonly providerInstances = new Map<string, ProviderInstance>();

    constructor(ctx: Context, public config: ModelServiceConfig) {
        super(ctx, Services.Model, true);

        this.registerFactories();
        this.initializeProviders();
    }

    /**
     * 在这里注册所有支持的 Provider 类型和它们对应的工厂。
     * 未来增加新的 Provider，只需在这里加一行。
     */
    private registerFactories(): void {
        this.providerFactories.set("OpenAI", new OpenAIFactory());
        this.providerFactories.set("OpenAI Compatible", new OpenAIFactory()); // 复用
        this.providerFactories.set("Ollama", new OllamaFactory());
        this.providerFactories.set("Anthropic", new AnthropicFactory());
        // ... this.providerFactories.set("Google Gemini", new GoogleGeminiFactory());
    }

    /**
     * 遍历用户配置，使用对应的工厂创建并初始化所有启用的 Provider。
     */
    private initializeProviders(): void {
        if (this.config.Providers.length == 0) {
            this.ctx.logger.warn("[ModelService] No providers configured.");
            return;
        }
        for (const providerConfig of this.config.Providers) {
            if (!providerConfig.Enabled) continue;

            const factory = this.providerFactories.get(providerConfig.Type);
            if (!factory) {
                this.ctx.logger.warn(
                    `[ModelService] No factory found for provider type "${providerConfig.Type}". Skipping provider "${providerConfig.Name}".`
                );
                continue;
            }

            try {
                const client = factory.createClient(providerConfig);
                const instance = new ProviderInstance(providerConfig, client);
                this.providerInstances.set(instance.name, instance);
                this.ctx.logger.info(`[ModelService] Initialized provider: "${instance.name}" (Type: ${providerConfig.Type})`);
            } catch (error) {
                this.ctx.logger.error(`[ModelService] Failed to initialize provider "${providerConfig.Name}":`, error);
            }
        }
    }

    // --- 公共 API ---

    public getChatModel(providerName: string, modelId: string): ChatModel | null {
        return this.providerInstances.get(providerName)?.getChatModel(modelId) ?? null;
    }

    public getEmbedModel(providerName: string, modelId: string): EmbedModel | null {
        return this.providerInstances.get(providerName)?.getEmbedModel(modelId) ?? null;
    }

    public getChatModelSwitcher(modelPriority: ModelDescriptor[]) {
        return new ChatModelSwitcher(this, modelPriority);
    }

    /**
     * 获取所有Provider名称
     */
    public getProviderNames(): string[] {
        return Array.from(this.providerInstances.keys());
    }

    /**
     * 获取所有Provider实例
     */
    public getProviderInstances(): Map<string, ProviderInstance> {
        return this.providerInstances;
    }
}

export class ChatModelSwitcher {
    private currentIndex = 0;

    constructor(private modelService: ModelService, private modelPriority: ModelDescriptor[]) {}

    public get length() {
        return this.modelPriority.length;
    }

    public getCurrent(): ChatModel {
        if (this.length === 0) {
            throw new Error("No models configured for ChatModelSwitcher.");
        }
        const descriptor = this.modelPriority[this.currentIndex];
        const model = this.modelService.getChatModel(descriptor.ProviderName, descriptor.ModelId);

        if (!model) {
            // 抛出明确的错误，而不是返回 undefined
            throw new Error(
                `Model not found or failed to initialize: Provider='${descriptor.ProviderName}', Model='${descriptor.ModelId}'`
            );
        }
        return model;
    }

    public switchToNext(): ChatModel {
        this.currentIndex = (this.currentIndex + 1) % this.length;
        return this.getCurrent();
    }

    /**
     * 获取当前模型描述符
     */
    public getCurrentDescriptor(): ModelDescriptor {
        if (this.length === 0) {
            throw new Error("No models configured for ChatModelSwitcher.");
        }
        return this.modelPriority[this.currentIndex];
    }
}
