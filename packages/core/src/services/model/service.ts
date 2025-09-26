import { Context, Schema, Service } from "koishi";

import { Config } from "@/config";
import { Services } from "@/shared/constants";
import { isNotEmpty } from "@/shared/utils";
import { IChatModel } from "./chat-model";
import { ModelDescriptor } from "./config";
import { IEmbedModel } from "./embed-model";
import { ProviderFactoryRegistry } from "./factories";
import { ChatModelSwitcher } from "./model-switcher";
import { ProviderInstance } from "./provider-instance";
import { ModelType } from "./types";

declare module "koishi" {
    interface Context {
        [Services.Model]: ModelService;
    }
}

export class ModelService extends Service<Config> {
    private readonly providerInstances = new Map<string, ProviderInstance>();

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Model, true);
        this.config = config;

        try {
            this.validateConfig();
            this.initializeProviders();
            this.registerSchemas();
        } catch (error: any) {
            this.ctx.logger.error(`模型服务初始化失败 | ${error.message}`);
            ctx.notifier.create({ type: "danger", content: `模型服务初始化失败 | ${error.message}` });
        }
    }

    private initializeProviders(): void {
        this.ctx.logger.info("--- 开始初始化模型提供商 ---");
        for (const providerConfig of this.config.providers) {
            const providerId = `${providerConfig.name} (${providerConfig.type})`;

            const factory = ProviderFactoryRegistry.get(providerConfig.type);
            if (!factory) {
                this.ctx.logger.error(`❌ 不支持的类型 | 提供商: ${providerId}`);
                continue;
            }

            try {
                const client = factory.createClient(providerConfig);
                const instance = new ProviderInstance(this.ctx, providerConfig, client);
                this.providerInstances.set(instance.name, instance);
                this.ctx.logger.success(`✅ 初始化成功 | 提供商: ${providerId} | 共 ${providerConfig.models.length} 个模型`);
            } catch (error: any) {
                this.ctx.logger.error(`❌ 初始化失败 | 提供商: ${providerId} | 错误: ${error.message}`);
            }
        }
        this.ctx.logger.info("--- 模型提供商初始化完成 ---");
    }

    /**
     * 验证是否有无效配置
     * 1. 至少有一个 Provider
     * 2. 每个 Provider 至少有一个模型
     * 3. 每个模型组至少有一个模型，且模型存在于已启用的 Provider 中
     * 4. 为核心任务分配的模型组存在
     */
    private validateConfig(): void {
        let modified = false;
        // this.ctx.logger.debug("开始验证服务配置");
        if (!this.config.providers || this.config.providers.length === 0) {
            throw new Error("配置错误: 至少需要配置一个模型提供商");
        }

        for (const providerConfig of this.config.providers) {
            if (providerConfig.models.length === 0) {
                throw new Error(`配置错误: 提供商 ${providerConfig.name} 至少需要配置一个模型`);
            }
        }

        if (this.config.modelGroups.length === 0) {
            const models = this.config.providers
                .map((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId, modelType: m.modelType })))
                .flat();
            const defaultChatGroup = {
                name: "_default",
                models: models.filter((m) => m.modelType === ModelType.Chat),
            };
            this.config.modelGroups.push(defaultChatGroup);
            modified = true;
        }

        for (const group of this.config.modelGroups) {
            if (group.models.length === 0) {
                throw new Error(`配置错误: 模型组 ${group.name} 至少需要包含一个模型`);
            }
        }

        const defaultGroup = this.config.modelGroups.find((g) => g.models.length > 0);

        const chatGroup = this.config.modelGroups.find((g) => g.name === this.config.chatModelGroup);
        if (!chatGroup) {
            this.ctx.logger.warn(
                `配置警告: 指定的聊天模型组 "${this.config.chatModelGroup}" 不存在，已重置为默认组 "${defaultGroup.name}"`
            );
            this.config.chatModelGroup = defaultGroup.name;
            modified = true;
        }

        if (modified) {
            const parent = this.ctx.scope.parent;
            if (parent.name === "yesimbot") {
                parent.scope.update(this.config);
            }
        } else {
            //this.ctx.logger.debug("配置验证通过");
        }
    }

    private registerSchemas() {
        const models = this.config.providers
            .map((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId, modelType: m.modelType })))
            .flat();

        const selectableModels = models
            .filter((m) => isNotEmpty(m.modelId) && isNotEmpty(m.providerName))
            .map((m) => {
                /* prettier-ignore */
                return Schema.const({ providerName: m.providerName, modelId: m.modelId }).description(`${m.providerName} - ${m.modelId}`);
            });

        const embeddingModels = models
            .filter((m) => isNotEmpty(m.modelId) && isNotEmpty(m.providerName) && m.modelType === ModelType.Embedding)
            .map((m) => {
                /* prettier-ignore */
                return Schema.const({ providerName: m.providerName, modelId: m.modelId }).description(`${m.providerName} - ${m.modelId}`);
            });

        this.ctx.schema.set(
            "modelService.selectableModels",
            Schema.union([
                ...selectableModels,
                Schema.object({
                    providerName: Schema.string().required().description("提供商名称"),
                    modelId: Schema.string().required().description("模型ID"),
                })
                    .role("table")
                    .description("自定义模型"),
            ]).default({ providerName: "", modelId: "" })
        );

        this.ctx.schema.set(
            "modelService.embeddingModels",
            Schema.union([
                ...embeddingModels,
                Schema.object({
                    providerName: Schema.string().required().description("提供商名称"),
                    modelId: Schema.string().required().description("模型ID"),
                })
                    .role("table")
                    .description("自定义模型"),
            ]).default({ providerName: "", modelId: "" })
        );

        this.ctx.schema.set(
            "modelService.availableGroups",
            Schema.union([
                ...this.config.modelGroups.map((group) => {
                    return Schema.const(group.name).description(group.name);
                }),
                Schema.string().description("自定义模型组"),
            ]).default("default")
        );

        // 混合类型，包括单个模型和模型组
        this.ctx.schema.set(
            "modelService.chatModelOrGroup",
            Schema.union([
                ...this.config.modelGroups.map((group) => {
                    return Schema.const(group.name).description(`模型组 - ${group.name}`);
                }),
                ...selectableModels,
                Schema.object({
                    providerName: Schema.string().required().description("提供商名称"),
                    modelId: Schema.string().required().description("模型ID"),
                })
                    .role("table")
                    .description("自定义模型"),
            ]).default({ providerName: "", modelId: "" })
        );
    }

    public getChatModel(modelDescriptor: ModelDescriptor): IChatModel | null;
    public getChatModel(providerName: string, modelId: string): IChatModel | null;
    public getChatModel(arg1: string | ModelDescriptor, arg2?: string): IChatModel | null {
        let providerName: string;
        let modelId: string;

        if (typeof arg1 === "string" && arg2) {
            providerName = arg1;
            modelId = arg2;
        } else if (typeof arg1 === "object") {
            providerName = arg1.providerName;
            modelId = arg1.modelId;
        } else {
            throw new Error("无效的参数");
        }

        if (!providerName || !modelId) {
            throw new Error("提供商名称和模型ID不能为空");
        }

        /* prettier-ignore */
        const instance = this.providerInstances.get(providerName);
        return instance ? instance.getChatModel(modelId) : null;
    }

    public getEmbedModel(modelDescriptor: ModelDescriptor): IEmbedModel | null;
    public getEmbedModel(providerName: string, modelId: string): IEmbedModel | null;
    public getEmbedModel(arg1: string | ModelDescriptor, arg2?: string): IEmbedModel | null {
        let providerName: string;
        let modelId: string;

        if (typeof arg1 === "string" && arg2) {
            providerName = arg1;
            modelId = arg2;
        } else if (typeof arg1 === "object") {
            providerName = arg1.providerName;
            modelId = arg1.modelId;
        } else {
            throw new Error("无效的参数");
        }

        if (!providerName || !modelId) {
            throw new Error("提供商名称和模型ID不能为空");
        }

        /* prettier-ignore */
        const instance = this.providerInstances.get(providerName);
        return instance ? instance.getEmbedModel(modelId) : null;
    }

    public useChatGroup(name?: string): ChatModelSwitcher | undefined {
        const groupName = name || this.config.chatModelGroup;
        if (!groupName) return undefined;

        const group = this.config.modelGroups.find((g) => g.name === groupName);
        if (!group) {
            this.ctx.logger.warn(`查找模型组失败 | 组名不存在: ${groupName}`);
            return undefined;
        }
        try {
            return new ChatModelSwitcher(this.ctx, group, this.getChatModel.bind(this), this.config.switchConfig);
        } catch (error: any) {
            this.ctx.logger.error(`创建模型组 "${groupName}" 失败 | ${error.message}`);
            return undefined;
        }
    }
}
