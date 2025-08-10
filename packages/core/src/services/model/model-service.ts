import { Services } from "@/shared/constants";
import { AppError, ErrorDefinitions } from "@/shared/errors";
import { isNotEmpty } from "@/shared/utils";
import { GenerateTextResult } from "@xsai/generate-text";
import { Awaitable, Context, Logger, Schema, Service } from "koishi";
import { BaseModel } from "./base-model";
import { ChatRequestOptions, IChatModel } from "./chat-model";
import { CircuitBreakerPolicy, ContentFailureAction, ModelDescriptor, ModelServiceConfig, ModelSwitchingStrategy } from "./config";
import { IEmbedModel } from "./embed-model";
import { ProviderFactoryRegistry } from "./factories";
import { ProviderInstance } from "./provider-instance";

// --- 断路器 (CircuitBreaker) ---
// 职责：跟踪单个模型的故障，在故障过多时暂时禁用它。

enum CircuitBreakerState {
    CLOSED, // 允许请求
    OPEN, // 阻止请求
    HALF_OPEN, // 允许一次探测请求
}

class CircuitBreaker {
    private state = CircuitBreakerState.CLOSED;
    private failureCount = 0;
    private lastFailureTime: number = 0;
    private readonly logger: Logger;

    constructor(
        private readonly policy: CircuitBreakerPolicy,
        parentLogger: Logger,
        private readonly modelId: string
    ) {
        this.logger = parentLogger.extend(`[断路器][${modelId}]`);
    }

    /** 检查断路器是否处于“打开”状态（即阻止请求） */
    public isOpen(): boolean {
        if (this.state === CircuitBreakerState.OPEN) {
            const now = Date.now();
            if (now - this.lastFailureTime > this.policy.cooldownSeconds * 1000) {
                this.state = CircuitBreakerState.HALF_OPEN;
                this.logger.info(`状态变更: OPEN -> HALF_OPEN (冷却期结束，准备探测)`);
                return false; // 允许一次探测请求
            }
            return true; // 仍然在冷却期，保持打开
        }
        return false;
    }

    /** 记录一次成功调用 */
    public recordSuccess(): void {
        if (this.state !== CircuitBreakerState.CLOSED) {
            this.logger.success(`状态变更: -> CLOSED (探测成功，恢复服务)`);
        }
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
    }

    /** 记录一次失败调用 */
    public recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.state = CircuitBreakerState.OPEN;
            this.logger.warn(`状态变更: HALF_OPEN -> OPEN (探测失败，重新开启断路器)`);
        } else if (this.failureCount >= this.policy.failureThreshold) {
            if (this.state !== CircuitBreakerState.OPEN) {
                this.state = CircuitBreakerState.OPEN;
                this.logger.warn(`状态变更: -> OPEN (达到失败阈值 ${this.policy.failureThreshold})`);
            }
        }
    }
}

// --- 服务声明 ---
declare module "koishi" {
    interface Context {
        [Services.Model]: ModelService;
    }
}

// --- 模型服务 (ModelService) ---
// 职责：管理和初始化所有模型提供商 (Provider)。

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
            this.registerSchemas();
        } catch (error) {
            this._logger.error(`初始化失败，请检查配置: ${error.message}`);
            // 配置错误是致命的，应该阻止服务启动
            throw error;
        }
    }

    private initializeProviders(): void {
        this._logger.info("--- 开始初始化模型提供商 ---");
        for (const providerConfig of this.config.providers) {
            const providerId = `${providerConfig.name} (${providerConfig.type})`;
            if (!providerConfig.enabled) {
                this._logger.info(`⚪ 跳过 (已禁用) | 提供商: ${providerId}`);
                continue;
            }

            const factory = ProviderFactoryRegistry.get(providerConfig.type);
            if (!factory) {
                this._logger.error(`❌ 不支持的类型 | 提供商: ${providerId}`);
                continue;
            }

            try {
                const client = factory.createClient(providerConfig);
                const instance = new ProviderInstance(this.ctx, providerConfig, client);
                this.providerInstances.set(instance.name, instance);
                this._logger.success(`✅ 初始化成功 | 提供商: ${providerId} | 共 ${providerConfig.models.length} 个模型`);
            } catch (error) {
                this._logger.error(`❌ 初始化失败 | 提供商: ${providerId} | 错误: ${error.message}`);
            }
        }
        this._logger.info("--- 模型提供商初始化完成 ---");
    }

    public getChatModel(providerName: string, modelId: string): IChatModel | null {
        const instance = this.providerInstances.get(providerName);
        return instance ? instance.getChatModel(modelId) : null;
    }

    public getEmbedModel(providerName: string, modelId: string): IEmbedModel | null {
        const instance = this.providerInstances.get(providerName);
        return instance ? instance.getEmbedModel(modelId) : null;
    }

    public useChatGroup(name: string): ChatModelSwitcher | undefined {
        const groupName = this.resolveGroupName(name);
        if (!groupName) return undefined;

        const group = this.config.modelGroups.find((g) => g.name === groupName);
        if (!group) {
            this._logger.warn(`[模型组] 查找失败，组名不存在: ${groupName}`);
            return undefined;
        }
        try {
            return new ChatModelSwitcher(this.ctx, group, this.getChatModel.bind(this));
        } catch (error) {
            this._logger.error(`[模型组] "${groupName}" 创建失败: ${error.message}`);
            return undefined;
        }
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
        // this._logger.debug("开始验证服务配置");
        if (!this.config.providers || this.config.providers.length === 0) {
            throw new AppError(ErrorDefinitions.CONFIG.INVALID, {
                args: ["至少需要配置一个提供商"],
            });
        }

        for (const providerConfig of this.config.providers) {
            if (providerConfig.models.length === 0) {
                throw new Error(`配置错误: 提供商 ${providerConfig.name} 至少需要配置一个模型`);
            }
        }

        if (this.config.modelGroups.length === 0) {
            const defaultGroup = {
                name: "default",
                models: this.config.providers.map((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId }))).flat(),
                strategy: ModelSwitchingStrategy.Failover,
            };
            this.config.modelGroups.push(defaultGroup);
            modified = true;
        }

        for (const group of this.config.modelGroups) {
            if (group.models.length === 0) {
                throw new Error(`配置错误: 模型组 ${group.name} 至少需要包含一个模型`);
            }
        }

        const defaultGroup = this.config.modelGroups.find((g) => g.models.length > 0);

        for (const task in this.config.task) {
            const groupName = this.config.task[task];
            if (!this.config.modelGroups.some((group) => group.name === groupName)) {
                this.config.task[task] = defaultGroup.name;
                //throw new Error(`配置错误: 为任务 ${task} 分配的模型组 ${groupName} 不存在`);
                this._logger.warn(`配置错误: 为任务 ${task} 分配的模型组 ${groupName} 不存在，已自动更正为默认组 ${defaultGroup.name}`);
                modified = true;
            }
        }
        if (modified) {
            //this._logger.warn("配置已自动更正，请检查并保存更改");
            this.ctx.scope.update(this.config);
        } else {
            //this._logger.debug("配置验证通过");
        }
    }

    private registerSchemas() {
        const models = this.config.providers.map((p) => p.models.map((m) => ({ providerName: p.name, modelId: m.modelId }))).flat();

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

    protected start(): Awaitable<void> {}

    public useEmbeddingGroup(name: string): ModelSwitcher<IEmbedModel> | undefined {
        const groupName = this.resolveGroupName(name);
        if (!groupName) return undefined; // resolveGroupName 内部会记录日志

        const group = this.config.modelGroups.find((g) => g.name === groupName);
        if (!group) {
            this._logger.warn(`[模型组] 查找失败，组名不存在: ${groupName}`);
            return undefined;
        }
        try {
            // 直接创建 ModelSwitcher<IEmbedModel> 实例
            return new ModelSwitcher<IEmbedModel>(this.ctx, group, this.getEmbedModel.bind(this));
        } catch (error) {
            this._logger.error(`[模型组] "${groupName}" 创建失败: ${error.message}`);
            return undefined;
        }
    }

    private resolveGroupName(name: string): string | undefined {
        if (this.config.task[name]) {
            return this.config.task[name];
        }

        this._logger.warn(`[切换器] ⚠ 无效的任务名称 | 任务: ${String(name)}`);
        return undefined;
    }
}

// --- 新增: 请求执行器 (RequestExecutor) ---
// 职责：封装单次请求的全部执行逻辑，包括重试、超时、断路器检查和故障转移。
class RequestExecutor {
    private readonly logger: Logger;
    private readonly accumulatedErrors: { modelId: string; error: Error }[] = [];

    constructor(
        ctx: Context,
        private readonly groupName: string,
        private readonly candidateModels: IChatModel[],
        private readonly circuitBreakers: Map<string, CircuitBreaker>
    ) {
        this.logger = ctx[Services.Logger].getLogger(`[请求执行器][${groupName}]`);
    }

    public async execute(options: ChatRequestOptions): Promise<GenerateTextResult> {
        const originalMessages = JSON.parse(JSON.stringify(options.messages));

        for (const model of this.candidateModels) {
            const breaker = this.circuitBreakers.get(model.id);
            if (breaker?.isOpen()) {
                this.logger.info(`[跳过] 模型 ${model.id} (断路器开启)`);
                continue;
            }

            // 执行单个模型的请求尝试（包含内部重试）
            const result = await this.tryRequestWithModel(model, options, originalMessages);

            // 如果成功，立即返回
            if (result.success) {
                breaker?.recordSuccess();
                return result.data;
            } else {
                // 如果失败，记录错误并继续尝试下一个模型（故障转移）
                breaker?.recordFailure();
                this.accumulatedErrors.push({ modelId: model.id, error: (result as any).error });
            }
        }

        // 所有模型都尝试失败后
        this.logger.error("所有可用模型均未能成功处理请求");
        const individualErrors = this.accumulatedErrors.map((e) => e.error);
        throw new AppError(ErrorDefinitions.MODEL.ALL_FAILED_IN_GROUP, {
            args: [this.groupName],

            cause: new AggregateError(individualErrors, "所有模型均失败"),
            context: {
                failedModels: this.accumulatedErrors.map((e) => ({ modelId: e.modelId, errorCode: (e.error as AppError).code })),
                accumulatedErrors: this.accumulatedErrors,
            },
        });
    }

    private async tryRequestWithModel(
        model: IChatModel,
        options: ChatRequestOptions,
        originalMessages: any[]
    ): Promise<{ success: true; data: GenerateTextResult } | { success: false; error: Error }> {
        const retryPolicy = model.config.retryPolicy ?? {
            maxRetries: 0,
            onContentFailure: ContentFailureAction.FailoverToNext,
        };
        const timeoutPolicy = model.config.timeoutPolicy ?? { totalTimeout: 90 };

        for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
            const attemptLogger = this.logger.extend(`[${model.id}] [尝试 ${attempt + 1}/${retryPolicy.maxRetries + 1}]`);
            const controller = new AbortController();

            const firstTokenTimeoutId = setTimeout(() => {
                const timeoutError = new Error(`First token not received within ${timeoutPolicy.firstTokenTimeout}s`);
                timeoutError.name = "AbortError";
                timeoutError["duration"] = timeoutPolicy.firstTokenTimeout;
                controller.abort(timeoutError);
            }, timeoutPolicy.firstTokenTimeout * 1000);

            const timeoutId = setTimeout(() => {
                const timeoutError = new Error(`Request timed out after ${timeoutPolicy.totalTimeout}s`);
                timeoutError.name = "AbortError";
                timeoutError["duration"] = timeoutPolicy.totalTimeout;
                controller.abort(timeoutError);
            }, timeoutPolicy.totalTimeout * 1000);

            options.abortSignal = controller.signal;

            options.onStreamStart = () => {
                clearTimeout(firstTokenTimeoutId);
            };

            try {
                attemptLogger.info("发送请求...");
                const result = await model.chat(options);
                clearTimeout(timeoutId);
                attemptLogger.success("请求成功");
                return { success: true, data: result };
            } catch (error) {
                clearTimeout(timeoutId);

                // 内容验证失败的特定处理
                if (error instanceof AppError && error.code === ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED.code) {
                    if (retryPolicy.onContentFailure === ContentFailureAction.AugmentAndRetry && attempt < retryPolicy.maxRetries) {
                        attemptLogger.warn("内容无效，修正 Prompt 并重试...");
                        options.messages = [
                            ...originalMessages,
                            {
                                role: "user",
                                content: "Note: Your previous response was invalid. Please strictly adhere to the required format.",
                            },
                        ];
                        continue; // 进入下一次重试循环
                    } else {
                        attemptLogger.error(`内容无效，放弃重试 | 错误: ${error.message}`);
                        return { success: false, error }; // 放弃当前模型
                    }
                }

                // 其他错误（网络，API限流等）
                attemptLogger.error(`请求失败 | 错误: ${error.message}`);
                if (attempt >= retryPolicy.maxRetries) {
                    return { success: false, error };
                }

                await new Promise((res) => setTimeout(res, 500 * (attempt + 1))); // 退避等待
            }
        }
        return {
            success: false,
            error: new AppError(ErrorDefinitions.MODEL.RETRY_EXHAUSTED, { args: [model.id] }),
        };
    }
}

// --- 简化的模型切换器 (ModelSwitcher) ---
// 职责：管理一个模型组中的模型列表，并根据上下文（如是否包含图片）提供合适的模型。
export class ModelSwitcher<T extends BaseModel> {
    protected readonly _logger: Logger;
    protected readonly _models: T[];
    private readonly circuitBreakers = new Map<string, CircuitBreaker>();

    constructor(
        protected readonly ctx: Context,
        protected readonly groupConfig: { name: string; models: ModelDescriptor[] },
        modelGetter: (providerName: string, modelId: string) => T | null
    ) {
        this._logger = ctx[Services.Logger].getLogger(`[模型组][${groupConfig.name}]`);

        this._models = groupConfig.models
            .map((desc) => modelGetter(desc.providerName, desc.modelId))
            .filter((model): model is T => {
                if (!model) this._logger.warn(`模型加载失败，将从组中移除`);
                return model !== null;
            });

        if (this._models.length === 0) {
            const errorMsg = "模型组中无任何可用的模型 (请检查模型配置和能力声明)";
            this._logger.error(`❌ 加载失败 | ${errorMsg}`);

            throw new AppError(ErrorDefinitions.MODEL.GROUP_INIT_FAILED, { args: [groupConfig.name] });
        }

        // 初始化断路器
        this._models.forEach((model) => {
            if (model.config.circuitBreakerPolicy) {
                this.circuitBreakers.set(model.id, new CircuitBreaker(model.config.circuitBreakerPolicy, this._logger, model.id));
            }
        });

        //this._logger.debug(`✅ 加载成功 | 可用模型数: ${this._models.length}`);
    }

    public getModels(): readonly T[] {
        return this._models;
    }

    protected getCircuitBreakers(): Map<string, CircuitBreaker> {
        return this.circuitBreakers;
    }
}

// --- 专用于聊天的模型切换器 ---
// 职责：提供一个简单的 `.chat()` 接口，内部处理视觉/非视觉模型选择，并调用 RequestExecutor。
export class ChatModelSwitcher extends ModelSwitcher<IChatModel> {
    private readonly visionModels: IChatModel[];
    private readonly nonVisionModels: IChatModel[];

    constructor(
        ctx: Context,
        groupConfig: { name: string; models: ModelDescriptor[] },
        modelGetter: (providerName: string, modelId: string) => IChatModel | null
    ) {
        super(ctx, groupConfig, modelGetter);

        // 根据能力对模型进行分类
        this.visionModels = this._models.filter((m) => m.isVisionModel?.());
        this.nonVisionModels = this._models.filter((m) => !m.isVisionModel?.());
        //this._logger.debug(`模型能力分类 | 视觉: ${this.visionModels.length} | 非视觉: ${this.nonVisionModels.length}`);
    }

    public hasVisionCapability(): boolean {
        return this.visionModels.length > 0;
    }

    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        /* prettier-ignore */
        // @ts-ignore
        const hasImages = options.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));

        let candidateModels: IChatModel[];

        if (hasImages) {
            if (this.visionModels.length > 0) {
                this._logger.info("检测到图片内容，将使用视觉模型");
                candidateModels = this.visionModels;
            } else {
                this._logger.warn("检测到图片内容，但组内无视觉模型，将忽略图片按纯文本处理");
                candidateModels = this.nonVisionModels;
            }
        } else {
            candidateModels = this._models; // 无图片，使用所有模型
        }

        if (candidateModels.length === 0) {
            // throw new AppError(`模型组 "${this.groupConfig.name}" 中没有合适的模型来处理此请求`, {
            //     code: ErrorCodes.RESOURCE.NOT_FOUND,
            // });
            throw new AppError(ErrorDefinitions.MODEL.NO_SUITABLE_MODEL, {
                args: [this.groupConfig.name],
            });
        }

        const executor = new RequestExecutor(this.ctx, this.groupConfig.name, candidateModels, this.getCircuitBreakers());
        return executor.execute(options);
    }
}
