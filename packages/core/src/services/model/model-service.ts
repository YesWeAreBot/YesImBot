import { writeFile } from "fs/promises";
import { Context, Logger, Service } from "koishi";
import path from "path";
import { AppError, ErrorCodes } from "../../shared";
import { Services } from "../types";
import { BaseModel } from "./base-model";
import { IChatModel } from "./chat-model";
import { ModelDescriptor, ModelServiceConfig, TaskType } from "./config";
import { IEmbedModel } from "./embed-model";
import { ProviderFactoryRegistry } from "./factories";
import { ProviderInstance } from "./provider-instance";

declare module "koishi" {
    interface Context {
        [Services.Model]: ModelService;
    }
}

export class ModelService extends Service<ModelServiceConfig> {
    static readonly inject = [Services.Logger];
    private readonly providerInstances = new Map<string, ProviderInstance>();
    private readonly _logger: Logger;

    constructor(ctx: Context, config: ModelServiceConfig) {
        super(ctx, Services.Model, true);
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[模型服务]");

        this.validateConfig();
        this.initializeProviders();
        this.updateModelsJson();
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
    private updateModelsJson(): void {
        const models = this.config.providers
            .filter((p) => p.enabled)
            .flatMap((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId })));

        writeFile(path.resolve(__dirname, "./models.json"), JSON.stringify(models, null, 2))
            .then(() => this._logger.debug("⚙️ 模型列表已更新"))
            .catch((error) => this._logger.error("⚙️ 更新模型列表失败", error.message));
    }

    private initializeProviders(): void {
        this._logger.info("开始初始化提供商...");
        for (const providerConfig of this.config.providers) {
            if (!providerConfig.enabled) {
                this._logger.info(`🔌 跳过 (未启用) | 提供商: ${providerConfig.name}`);
                continue;
            }

            const factory = ProviderFactoryRegistry.get(providerConfig.type);
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

    private getModel<T extends BaseModel>(
        providerName: string,
        modelId: string,
        getter: (instance: ProviderInstance, modelId: string) => T | null
    ): T | null {
        const instance = this.providerInstances.get(providerName);
        return instance ? getter(instance, modelId) : null;
    }

    public getChatModel(providerName: string, modelId: string): IChatModel | null {
        return this.getModel(providerName, modelId, (instance, id) => instance.getChatModel(id));
    }

    public getEmbedModel(providerName: string, modelId: string): IEmbedModel | null {
        return this.getModel(providerName, modelId, (instance, id) => instance.getEmbedModel(id));
    }

    private _createSwitcher<T extends BaseModel>(
        groupName: string,
        modelGetter: (provider: string, modelId: string) => T | null
    ): ModelSwitcher<T> | undefined {
        const group = this.config.modelGroups[groupName];
        if (!group) {
            this._logger.warn(`[切换器] ⚠ 组未找到 | 名称: ${groupName}`);
            return undefined;
        }

        try {
            // 在这里传入模型获取函数，实现泛型
            return new ModelSwitcher<T>(this.ctx, group, groupName, modelGetter);
        } catch (error) {
            this._logger.error(`[切换器] ✖ 创建失败 | 组: ${groupName} | 错误: ${error.message}`);
            return undefined;
        }
    }

    public useChatGroup(name: TaskType): ModelSwitcher<IChatModel> | undefined {
        const groupName = this.resolveGroupName(name);
        if (!groupName) return undefined;
        return this._createSwitcher(groupName, this.getChatModel.bind(this));
    }

    public useEmbeddingGroup(name: TaskType): ModelSwitcher<IEmbedModel> | undefined {
        const groupName = this.resolveGroupName(name);
        if (!groupName) return undefined;
        return this._createSwitcher(groupName, this.getEmbedModel.bind(this));
    }

    private resolveGroupName(name: TaskType): string | undefined {
        if (this.config.taskAssignments[name]) {
            return this.config.taskAssignments[name];
        }

        if (this.config.modelGroups[name]) {
            return name;
        }

        this._logger.warn(`[切换器] ⚠ 无效的任务符号 | 任务: ${name}`);
        return undefined;
    }
}

/**
 * 泛型模型切换器
 * 支持代理任何继承自 BaseModel 的模型类型，并在初始化时验证其能力。
 */
export class ModelSwitcher<T extends BaseModel> {
    private readonly models: T[];
    private currentIndex = 0;
    private readonly _logger: Logger;

    constructor(
        ctx: Context,
        modelDescriptors: ModelDescriptor[],
        private groupName: string,
        modelGetter: (providerName: string, modelId: string) => T | null
    ) {
        this._logger = ctx[Services.Logger].getLogger(`[模型切换器] [${groupName}]`);
        this._logger.debug(`开始加载模型组...`);

        this.models = modelDescriptors
            .map((descriptor) => {
                const model = modelGetter(descriptor.providerName, descriptor.modelId);
                if (!model) {
                    // getModel 方法内部已经记录了详细日志 (未找到/能力不匹配)
                    // this._logger.warn(`⚠ 模型不可用 | ID: ${descriptor.modelId}, 提供商: ${descriptor.providerName}`);
                    return null;
                }
                return model;
            })
            .filter((model): model is T => model !== null);

        if (this.models.length === 0) {
            this._logger.error("✖ 致命错误 | 模型组中无任何可用的模型 (请检查模型配置和能力声明)");
            throw new AppError("模型组中未找到任何可用的模型", {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "Model", resourceId: `group:${groupName}` },
            });
        }
        this._logger.debug(`✔ 加载成功 | 可用模型数: ${this.models.length}`);
    }

    public getCurrent(): T {
        return this.models[this.currentIndex];
    }

    public switchToNext(): T {
        if (this.models.length <= 1) return this.getCurrent(); // 如果只有一个模型，不切换
        const oldIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % this.models.length;
        const oldModel = this.models[oldIndex].id;
        const newModel = this.getCurrent().id;
        this._logger.info(`模型切换 | 从: ${oldModel} -> 到: ${newModel}`);
        return this.getCurrent();
    }
}
