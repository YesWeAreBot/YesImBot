import { Context, Service } from "koishi";
import { Services } from "../types";
import { ChatModel } from "./chat-model";
import { ModelDescriptor, ModelServiceConfig } from "./config";
import { AnthropicFactory, IProviderFactory, OllamaFactory, OpenAIFactory } from "./factories";
import { ProviderInstance } from "./provider-instance";

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

        /**
         * 验证是否有无效配置
         * 1. 至少有一个 Provider
         * 2. 每个 Provider 至少有一个模型
         * 3. 每个模型组至少有一个模型，且模型存在于已启用的 Provider 中
         * 4. 为核心任务分配的模型组存在
         */

        if (this.config.providers.length === 0) {
            throw new Error("至少需要配置一个提供商");
        }

        for (const providerConfig of this.config.providers) {
            if (providerConfig.models.length === 0) {
                throw new Error(`提供商 ${providerConfig.name} 至少需要配置一个模型`);
            }
        }

        for (const groupName in this.config.modelGroups) {
            const group = this.config.modelGroups[groupName];
            if (group.length === 0) {
                throw new Error(`模型组 ${groupName} 至少需要包含一个模型`);
            }
        }

        for (const task in this.config.taskAssignments) {
            const group = this.config.modelGroups[this.config.taskAssignments[task]];
            if (!group) {
                throw new Error(`为核心任务 ${task} 分配的模型组 ${this.config.taskAssignments[task]} 不存在`);
            }
        }

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

    /**
     * 通过模型组名称获取一个模型切换器，包含了该组中的所有模型。
     * @param name 模型组名称或预定义的模型组符号。
     * @throws
     * @returns
     */
    public useGroup(name: string | symbol): ModelSwitcher | undefined {
        if (typeof name === "string") {
            const group = this.config.modelGroups[name];
            if (!group) {
                this.ctx.logger.warn(`未找到模型组: ${name}`);
                return;
            } else if (group.length === 0) {
                this.ctx.logger.warn(`模型组 ${name} 中未定义任何模型`);
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
                    this.ctx.logger.warn(`未找到模型组: ${Symbol.keyFor(name)}`);
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

        if (this.models.length === 0) {
            this.ctx.logger.error("未找到任何可用模型");
        }
    }

    public getCurrent(): ChatModel {
        return this.models[this.currentIndex];
    }

    public switchToNext(): ChatModel {
        this.currentIndex = (this.currentIndex + 1) % this.models.length;
        return this.getCurrent();
    }
}
