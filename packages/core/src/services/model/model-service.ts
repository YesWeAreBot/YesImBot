import { Services } from "@/shared/constants";
import { AppError, ErrorCodes } from "@/shared/errors";
import { isNotEmpty } from "@/shared/utils";
import { Awaitable, Context, Logger, Schema, Service } from "koishi";
import { BaseModel } from "./base-model";
import { ChatRequestOptions, IChatModel } from "./chat-model";
import { ContentFailureAction, ModelDescriptor, ModelServiceConfig } from "./config";
import { IEmbedModel } from "./embed-model";
import { ProviderFactoryRegistry } from "./factories";
import { ProviderInstance } from "./provider-instance";
import { ModelSwitchingStrategy, RetryPolicy, TimeoutPolicy, CircuitBreakerPolicy } from "./config"; // 引入新类型
import { GenerateTextResult } from "@xsai/generate-text";

enum CircuitBreakerState {
    OPEN,
    CLOSED,
    HALF_OPEN,
}

class CircuitBreaker {
    private state = CircuitBreakerState.CLOSED;
    private failureCount = 0;
    private lastFailureTime: number = 0;

    constructor(private policy: CircuitBreakerPolicy, private logger: Logger, private modelId: string) {}

    public get isOpen(): boolean {
        if (this.state === CircuitBreakerState.OPEN) {
            const now = Date.now();
            if (now - this.lastFailureTime > this.policy.cooldownSeconds * 1000) {
                this.state = CircuitBreakerState.HALF_OPEN;
                this.logger.info(`[断路器] 状态改变: OPEN -> HALF_OPEN | 模型: ${this.modelId}`);
                return false; // 允许一次探测请求
            }
            return true;
        }
        return false;
    }

    public recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.policy.failureThreshold) {
            this.state = CircuitBreakerState.OPEN;
            this.logger.warn(`[断路器] 触发！状态改变: -> OPEN | 模型: ${this.modelId}`);
        }
    }

    public recordSuccess(): void {
        this.failureCount = 0;
        if (this.state !== CircuitBreakerState.CLOSED) {
            this.state = CircuitBreakerState.CLOSED;
            this.logger.success(`[断路器] 状态改变: -> CLOSED | 模型: ${this.modelId}`);
        }
    }
}

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

        try {
            this.validateConfig();
            this.initializeProviders();
        } catch (error) {
            this._logger.error(`配置错误: ${error.message}`);
            // throw error;
        }
    }

    protected start(): Awaitable<void> {
        const models = this.config.providers
            .map((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId })))
            .flat();

        const selectableModels = models
            .filter((m) => isNotEmpty(m.modelId) && isNotEmpty(m.providerName))
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
            "modelService.availableGroups",
            Schema.union([
                ...this.config.modelGroups.map((group) => {
                    return Schema.const(group.name).description(group.name);
                }),
                Schema.string().description("自定义模型组"),
            ]).default("default")
        );
    }

    /**
     * 验证是否有无效配置
     * 1. 至少有一个 Provider
     * 2. 每个 Provider 至少有一个模型
     * 3. 每个模型组至少有一个模型，且模型存在于已启用的 Provider 中
     * 4. 为核心任务分配的模型组存在
     */
    private validateConfig(): void {
        // this._logger.debug("开始验证服务配置");
        if (this.config.providers.length === 0) {
            throw new Error("配置错误: 至少需要配置一个提供商。");
        }

        for (const providerConfig of this.config.providers) {
            if (providerConfig.models.length === 0) {
                throw new Error(`配置错误: 提供商 ${providerConfig.name} 至少需要配置一个模型。`);
            }
        }

        for (const group of this.config.modelGroups) {
            if (group.models.length === 0) {
                throw new Error(`配置错误: 模型组 ${group.name} 至少需要包含一个模型。`);
            }
        }

        for (const task in this.config.task) {
            const groupName = this.config.task[task];
            if (!this.config.modelGroups.some((group) => group.name === groupName)) {
                throw new Error(`配置错误: 为任务 ${task} 分配的模型组 ${groupName} 不存在。`);
            }
        }
        this._logger.debug("配置验证通过");
    }

    private initializeProviders(): void {
        // this._logger.info("开始初始化提供商...");
        for (const providerConfig of this.config.providers) {
            if (!providerConfig.enabled) {
                this._logger.info(`跳过 (未启用) | 提供商: ${providerConfig.name}`);
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
                // this._logger.success(`✔ 提供商初始化成功 | 名称: ${instance.name}`);
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

    /**
     * 获取一个聊天模型
     * @param providerName
     * @param modelId
     * @returns
     */
    public getChatModel(providerName: string, modelId: string): IChatModel | null {
        return this.getModel(providerName, modelId, (instance, id) => instance.getChatModel(id));
    }

    public getEmbedModel(providerName: string, modelId: string): IEmbedModel | null {
        return this.getModel(providerName, modelId, (instance, id) => instance.getEmbedModel(id));
    }

    /**
     * 创建一个模型切换器
     * @param groupName
     * @param modelGetter
     * @returns
     */
    /* prettier-ignore */
    private _createSwitcher<T extends BaseModel>(groupName: string, modelGetter: (provider: string, modelId: string) => T | null): ModelSwitcher<T> | undefined {
    const group = this.config.modelGroups.find((g) => g.name === groupName);
        if (!group) {
            this._logger.warn(`[切换器] ⚠ 组未找到 | 名称: ${groupName}`);
            return undefined;
        }

        try {
            // 在这里传入模型获取函数，实现泛型
            return new ModelSwitcher<T>(this.ctx, group, modelGetter);
        } catch (error) {
            this._logger.error(`[切换器] ✖ 创建失败 | 组: ${groupName} | 错误: ${error.message}`);
            return undefined;
        }
    }

    /**
     * 通过模型组名称获取一个聊天模型切换器
     * @param name
     * @returns
     */
    public useChatGroup(name: string): ModelSwitcher<IChatModel> | undefined {
        const groupName = this.resolveGroupName(name);
        if (!groupName) return undefined;
        return this._createSwitcher(groupName, this.getChatModel.bind(this));
    }

    public useEmbeddingGroup(name: string): ModelSwitcher<IEmbedModel> | undefined {
        const groupName = this.resolveGroupName(name);
        if (!groupName) return undefined;
        return this._createSwitcher(groupName, this.getEmbedModel.bind(this));
    }

    private resolveGroupName(name: string): string | undefined {
        if (this.config.task[name]) {
            return this.config.task[name];
        }

        this._logger.warn(`[切换器] ⚠ 无效的任务名称 | 任务: ${String(name)}`);
        return undefined;
    }
}

export class ModelSwitcher<T extends BaseModel> {
    private readonly _models: T[];
    private readonly strategy: ModelSwitchingStrategy;
    private readonly circuitBreakers = new Map<string, CircuitBreaker>();
    private currentIndex = 0;
    private readonly _logger: Logger;

    private visionModels: IChatModel[] = [];
    private nonVisionModels: IChatModel[] = [];

    get models(): T[] {
        return this._models;
    }

    get current(): T {
        return this._models[this.currentIndex];
    }

    public next(): T {
        if (this._models.length <= 1) return this.current;
        const oldIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % this._models.length;
        const oldModel = this._models[oldIndex].id;
        const newModel = this.current.id;
        this._logger.info(`模型切换 | 从: ${oldModel} -> 到: ${newModel}`);
        return this.current;
    }

    get length(): number {
        return this._models.length;
    }

    constructor(
        ctx: Context,
        private readonly groupConfig: { name: string; strategy: ModelSwitchingStrategy; models: ModelDescriptor[] },
        modelGetter: (providerName: string, modelId: string) => T | null
    ) {
        this._logger = ctx[Services.Logger].getLogger(`[模型切换器] [${groupConfig.name}]`);
        this.strategy = groupConfig.strategy;

        this._models = groupConfig.models
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

        if (this._models.length === 0) {
            this._logger.error("✖ 加载失败 | 模型组中无任何可用的模型 (请检查模型配置和能力声明)");
            throw new AppError("模型组中未找到任何可用的模型", {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "Model", resourceId: `group:${groupConfig.name}` },
            });
        }
        this._logger.debug(`✔ 加载成功 | 可用模型数: ${this._models.length}`);

        this._models.forEach((model) => {
            if ((model as unknown as IChatModel).isVisionModel?.()) {
                this.visionModels.push(model as unknown as IChatModel);
            } else {
                this.nonVisionModels.push(model as unknown as IChatModel);
            }
        });

        this._logger.debug(
            `✔ 能力分类完成 | 视觉模型: ${this.visionModels.length} | 非视觉模型: ${this.nonVisionModels.length}`
        );

        // 初始化断路器
        this._models.forEach((model) => {
            const policy = model.config.circuitBreakerPolicy;
            if (policy) {
                this.circuitBreakers.set(model.id, new CircuitBreaker(policy, this._logger, model.id));
            }
        });

        if (this._models.length === 0) {
            this._logger.error("✖ 加载失败 | 模型组中无任何可用的模型 (请检查模型配置和能力声明)");
        }
    }

    /**
     * 检查此模型组是否包含任何支持视觉（图片识别）的模型。
     */
    public hasVisionCapability(): boolean {
        return this.visionModels.length > 0;
    }

    /**
     * 获取此模型组中所有模型的列表（只读）。
     */
    public getModels(): readonly T[] {
        return this._models;
    }

    private getNextModelIndex(): number {
        if (this.strategy === ModelSwitchingStrategy.RoundRobin) {
            const nextIndex = this.currentIndex;
            this.currentIndex = (this.currentIndex + 1) % this._models.length;
            return nextIndex;
        }
        // 对于 Failover，索引由外部循环控制
        return this.currentIndex;
    }

    // --- 新的核心执行方法 ---
    public async executeChat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        /* prettier-ignore */
        // @ts-ignore
        const hasImages = options.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));

        // 关键：根据上下文内容选择要遍历的模型列表
        const candidateModels = hasImages && this.visionModels.length > 0 ? this.visionModels : this._models; // 如果没有图片或没有视觉模型，则使用所有模型

        if (hasImages && this.visionModels.length === 0) {
            this._logger.warn(
                `上下文包含图片，但模型组 "${this.groupConfig.name}" 中没有支持视觉的模型。将按纯文本处理。`
            );
        }

        const maxAttemptsPerModel = 1; // 默认值
        const originalMessages = JSON.parse(JSON.stringify(options.messages)); // 深拷贝以备重试

        for (let i = 0; i < candidateModels.length; i++) {
            const model = candidateModels[i] as unknown as IChatModel;
            const breaker = this.circuitBreakers.get(model.id);

            if (breaker?.isOpen) {
                this._logger.warn(`跳过模型 (断路器开启) | 模型: ${model.id}`);
                continue;
            }

            const retryPolicy = model.config.retryPolicy ?? {
                maxRetries: 0,
                onContentFailure: ContentFailureAction.FailoverToNext,
            };
            const timeoutPolicy = model.config.timeoutPolicy ?? { totalTimeout: 90 };

            for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    this._logger.warn(`总超时触发 (${timeoutPolicy.totalTimeout}s) | 模型: ${model.id}`);
                    controller.abort();
                }, timeoutPolicy.totalTimeout * 1000);

                try {
                    this._logger.info(
                        `尝试请求 | 模型: ${model.id} | 尝试: ${attempt + 1}/${retryPolicy.maxRetries + 1}`
                    );
                    const result = await model.chat(options, controller.signal);

                    clearTimeout(timeoutId);
                    breaker?.recordSuccess();
                    this._logger.success(`请求成功 | 模型: ${model.id}`);
                    return result;
                } catch (error) {
                    clearTimeout(timeoutId);

                    // 内容验证失败的特定处理
                    if (error instanceof AppError && error.code === ErrorCodes.LLM.OUTPUT_PARSING_FAILED) {
                        if (
                            retryPolicy.onContentFailure === ContentFailureAction.AugmentAndRetry &&
                            attempt < retryPolicy.maxRetries
                        ) {
                            this._logger.warn(`内容无效，修正Prompt并重试... | 模型: ${model.id}`);
                            options.messages = [
                                ...originalMessages,
                                {
                                    role: "user",
                                    content:
                                        "Note: Your previous response was not in the correct format. Please strictly follow the required output format.",
                                },
                            ];
                            continue; // 进入下一次重试循环
                        } else {
                            this._logger.error(`内容无效，切换到下一个模型 | 模型: ${model.id}`);
                            breaker?.recordFailure();
                            break; // 跳出重试循环，进入下一个模型
                        }
                    }

                    // 其他错误（网络，超时等）
                    this._logger.error(`请求失败 | 模型: ${model.id} | 错误: ${error.message}`);
                    if (attempt >= retryPolicy.maxRetries) {
                        breaker?.recordFailure();
                        break; // 所有重试用尽，切换模型
                    }
                    // 等待一小段时间再重试
                    await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
                }
            } // end of retry loop
        } // end of model loop
        // 如果 visionModels 失败了，是否要回退到 nonVisionModels？
        // 当前设计是：如果提供了图片，就只尝试 visionModels。如果它们都失败了，整个请求就失败。
        // 这是合理的，因为非视觉模型无法处理图片。

        throw new AppError(`模型组 "${this.groupConfig.name}" 中没有合适的模型能够成功响应请求`, {
            code: ErrorCodes.SERVICE.UNAVAILABLE,
        });
    }
}
