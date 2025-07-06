import { writeFile } from "fs/promises";
import { Context, Logger, Service } from "koishi";
import path from "path";
import { AppError, ErrorCodes } from "../../shared";
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
    static readonly inject = [Services.Logger];
    // 工厂注册表
    private readonly providerFactories = new Map<string, IProviderFactory>();
    // 实例化的 Provider 缓存
    private readonly providerInstances = new Map<string, ProviderInstance>();
    private readonly _logger: Logger;

    constructor(ctx: Context, config: ModelServiceConfig) {
        super(ctx, Services.Model, true);
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[模型服务]");

        this.validateConfig();
        this.registerFactories();
        this.initializeProviders();
    }

    /**
     * 验证是否有无效配置
     * 1. 至少有一个 Provider
     * 2. 每个 Provider 至少有一个模型
     * 3. 每个模型组至少有一个模型，且模型存在于已启用的 Provider 中
     * 4. 为核心任务分配的模型组存在
     */
    private validateConfig(): void {
        this._logger.debug("⚙️ 开始验证服务配置...");
        if (this.config.providers.length === 0) {
            throw new Error("配置错误: 至少需要配置一个提供商。");
        }

        for (const providerConfig of this.config.providers) {
            if (providerConfig.models.length === 0) {
                throw new Error(`配置错误: 提供商 ${providerConfig.name} 至少需要配置一个模型。`);
            }
        }

        for (const groupName in this.config.modelGroups) {
            const group = this.config.modelGroups[groupName];
            if (group.length === 0) {
                throw new Error(`配置错误: 模型组 ${groupName} 至少需要包含一个模型。`);
            }
        }

        for (const task in this.config.taskAssignments) {
            const groupName = this.config.taskAssignments[task];
            if (!this.config.modelGroups[groupName]) {
                throw new Error(`配置错误: 为任务 ${task} 分配的模型组 ${groupName} 不存在。`);
            }
        }
        this._logger.debug("⚙️ 配置验证通过。");

        const models = this.config.providers.map((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId }))).flat();

        writeFile(path.resolve(__dirname, "./models.json"), JSON.stringify(models, null, 2))
            .then(() => {
                this._logger.debug("⚙️ 模型列表已更新");
            })
            .catch((error) => {
                this._logger.error("⚙️ 更新模型列表失败", error.message);
            });
    }

    private registerFactories(): void {
        this.providerFactories.set("OpenAI", new OpenAIFactory());
        this.providerFactories.set("OpenAI Compatible", new OpenAIFactory());
        this.providerFactories.set("Ollama", new OllamaFactory());
        this.providerFactories.set("Anthropic", new AnthropicFactory());
        this._logger.debug(`注册了 ${this.providerFactories.size} 个提供商工厂`);
    }

    private initializeProviders(): void {
        this._logger.info("开始初始化提供商...");
        for (const providerConfig of this.config.providers) {
            if (!providerConfig.enabled) {
                this._logger.info(`🔌 跳过 (未启用) | 提供商: ${providerConfig.name}`);
                continue;
            }

            const factory = this.providerFactories.get(providerConfig.type);
            if (!factory) {
                this._logger.error(`✖ 不支持的提供商类型 | 类型: ${providerConfig.type}`);
                continue;
            }

            try {
                const client = factory.createClient(providerConfig);
                const instance = new ProviderInstance(this.ctx, providerConfig, client);
                this.providerInstances.set(instance.name, instance);
                this._logger.success(`✔ 提供商初始化成功 | 名称: ${instance.name}`);
            } catch (error) {
                this._logger.error(`✖ 提供商初始化失败 | 名称: ${providerConfig.name} | 错误: ${error.message}`);
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
        let groupName: string;
        let group: ModelDescriptor[];

        if (typeof name === "string") {
            groupName = name;
            group = this.config.modelGroups[groupName];
        } else {
            switch (name) {
                case ModelGroup.Chat:
                    groupName = this.config.taskAssignments.chat;
                    break;
                case ModelGroup.Embedding:
                    groupName = this.config.taskAssignments.embedding;
                    break;
                case ModelGroup.Summarization:
                    groupName = this.config.taskAssignments.summarization;
                    break;
                default:
                    this._logger.warn(`[切换器] ⚠ 任务未分配模型组 | 任务: ${Symbol.keyFor(name)}`);
                    return undefined;
            }
            group = this.config.modelGroups[groupName];
        }

        if (!group) {
            this._logger.warn(`[切换器] ⚠ 组未找到 | 名称: ${groupName}`);
            return undefined;
        } else if (group.length === 0) {
            this._logger.warn(`[切换器] ⚠ 组为空 | 名称: ${groupName}`);
            return undefined;
        }

        try {
            return new ModelSwitcher(this.ctx, this, group, groupName);
        } catch (error) {
            // ModelSwitcher 构造函数中的错误会被捕获，这里只记录一下上下文
            this._logger.error(`[切换器] ✖ 创建失败 | 组: ${groupName} | 错误: ${error.message}`);
            return undefined;
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
    private readonly models: ChatModel[];
    private currentIndex = 0;
    private readonly _logger: Logger;

    constructor(private ctx: Context, private modelService: ModelService, modelDescriptors: ModelDescriptor[], private groupName: string) {
        this._logger = ctx[Services.Logger].getLogger(`[模型切换器] [${groupName}]`);
        this._logger.debug(`开始加载模型组...`);

        this.models = modelDescriptors
            .map((descriptor) => {
                const model = this.modelService.getChatModel(descriptor.providerName, descriptor.modelId);
                if (!model) {
                    this._logger.warn(`⚠ 模型未找到 | ID: ${descriptor.modelId}, 提供商: ${descriptor.providerName}`);
                    return null;
                }
                return model;
            })
            .filter((model): model is ChatModel => model !== null);

        if (this.models.length === 0) {
            this._logger.error("✖ 致命错误 | 模型组中无任何可用模型");
            throw new AppError("模型组中未找到任何可用的模型", {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "Model", resourceId: `group:${groupName}` },
            });
        }
        this._logger.debug(`✔ 加载成功 | 可用模型数: ${this.models.length}`);
    }

    public getCurrent(): ChatModel {
        return this.models[this.currentIndex];
    }

    public switchToNext(): ChatModel {
        const oldIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % this.models.length;
        const oldModel = this.models[oldIndex].id;
        const newModel = this.getCurrent().id;
        this._logger.info(`模型切换 | 从: ${oldModel} -> 到: ${newModel}`);
        return this.getCurrent();
    }
}
