import { Context, Service } from "koishi";
import { Services } from "../types";

import { IProviderFactory } from "./factories/base";
import { ProviderInstance } from "./impl/provider-instance";

import { AnthropicFactory, OllamaFactory, OpenAIFactory } from "./factories";

import { ModelConfigSchema, ModelDescriptor, ModelServiceConfig } from "./config";
import { ChatModel } from "./impl/chat-model";

declare module "koishi" {
    interface Context {
        [Services.Model]: ModelService;
    }
}

export class ModelService extends Service<ModelServiceConfig> {
    // 工厂注册表
    private readonly providerFactories = new Map<string, IProviderFactory>();
    // 实例化的 Provider 缓存
    private readonly providerInstances = new Map<string, ProviderInstance>();

    constructor(ctx: Context, config: ModelServiceConfig) {
        super(ctx, Services.Model, true);

        this.ctx = ctx;
        this.config = config;

        this.registerFactories();
        this.initializeProviders();
    }

    private registerFactories(): void {
        this.providerFactories.set("OpenAI", new OpenAIFactory());
        this.providerFactories.set("OpenAI Compatible", new OpenAIFactory());
        this.providerFactories.set("Ollama", new OllamaFactory());
        this.providerFactories.set("Anthropic", new AnthropicFactory());
    }

    private initializeProviders(): void {
        for (const providerConfig of this.config.providers) {
            if (!providerConfig.enabled) {
                this.ctx.logger.info("跳过禁用的提供商: {0}", providerConfig.name);
                continue;
            }

            const factory = this.providerFactories.get(providerConfig.type);
            if (!factory) {
                this.ctx.logger.warn("不支持的提供商类型: {0}", providerConfig.type);
                continue;
            }

            try {
                const client = factory.createClient(providerConfig);
                const instance = new ProviderInstance(this.ctx, providerConfig, client);
                this.providerInstances.set(instance.name, instance);
                this.ctx.logger.info("成功初始化提供商: {0}", instance.name);
            } catch (error) {
                this.ctx.logger.error("初始化提供商时出错: {0}", error.message);
            }
        }
    }

    public useGroup(name: string | symbol): ModelSwitcher {
        if (typeof name === "string") {
            const group = this.config.modelGroups[name];
            if (!group) {
                this.ctx.logger.warn("未找到模型组: {0}", name);
                return;
            }
            return new ModelSwitcher(this.ctx, this, group);
        } else {
            switch (name) {
                case ModelGroup.Chat:
                    return this.useGroup(this.config.taskAssignments.chat);
                case ModelGroup.Embedding:
                    return this.useGroup(this.config.taskAssignments.embedding);
                case ModelGroup.Summarization:
                    return this.useGroup(this.config.taskAssignments.summarization);
                default:
                    this.ctx.logger.warn("未找到模型组: {0}", name);
                    return;
            }
        }
    }

    public getChatModel(providerName: string, modelId: string): ChatModel | null {
        return this.providerInstances.get(providerName)?.getChatModel(modelId) ?? null;
    }
}

export const ModelGroup = {
    Chat: Symbol("Chat"),
    Embedding: Symbol("Embedding"),
    Summarization: Symbol("Summarization"),
};

export class ModelSwitcher {
    private ctx: Context;
    private models: ChatModel[];
    private currentIndex = 0;

    constructor(ctx: Context, private modelService: ModelService, modelGroup: ModelDescriptor[]) {
        this.ctx = ctx;

        this.models = modelGroup
            .map((descriptor) => {
                const model = this.modelService.getChatModel(descriptor.providerName, descriptor.modelId);
                if (!model) {
                    this.ctx.logger.warn("未找到模型: {0}", descriptor);
                }
                return model;
            })
            .filter(Boolean);
    }

    public getCurrent(): ChatModel {
        return this.models[this.currentIndex];
    }

    public switchToNext(): ChatModel {
        this.currentIndex = (this.currentIndex + 1) % this.models.length;
        return this.getCurrent();
    }
}
