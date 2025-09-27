import type { GenerateTextResult } from "@xsai/generate-text";
import type { Message } from "@xsai/shared-chat";
import { Logger } from "koishi";

import { BaseModel } from "./base-model";
import { ChatRequestOptions, IChatModel } from "./chat-model";
import { ModelDescriptor, StrategyConfig } from "./config";
import { ChatModelType, ModelError, ModelErrorType, ModelStatus, SwitchStrategy, CircuitState } from "./types";

// 指数移动平均 (EMA) 的 alpha 值，值越小，历史数据权重越大
const EMA_ALPHA = 0.2;

export interface IModelSwitcher<T extends BaseModel> {
    /** 根据可用性和策略获取一个模型 */
    getModel(): T | null;

    /** 获取所有已配置的模型 */
    getModels(): T[];

    /** 获取指定模型的状态 */
    getModelStatus(model: T): ModelStatus;

    /** 检查一个模型当前是否可用 (通过熔断器状态判断) */
    isModelAvailable(model: T): boolean;

    /** 记录一次模型调用的结果，并更新其状态 */
    recordResult(model: T, success: boolean, error?: ModelError, latency?: number): void;
}

export abstract class ModelSwitcher<T extends BaseModel> implements IModelSwitcher<T> {
    protected currentRoundRobinIndex: number = 0;
    protected readonly modelStatusMap = new Map<string, ModelStatus>();

    constructor(
        protected readonly logger: Logger,
        protected readonly models: T[],
        protected config: StrategyConfig
    ) {
        for (const model of this.models) {
            const weights = (config as any).weights; // Safely access potential weights
            this.modelStatusMap.set(model.id, {
                circuitState: "CLOSED",
                failureCount: 0,
                averageLatency: 0,
                totalRequests: 0,
                successRequests: 0,
                successRate: 1.0,
                weight: config.strategy === SwitchStrategy.WeightedRandom ? weights?.[model.id] || 1 : 1,
            });
        }
    }

    public getModel(): T | null {
        const availableModels = this.models.filter((model) => this.isModelAvailable(model));

        if (availableModels.length === 0) {
            return null;
        }

        return this.selectModelByStrategy(availableModels);
    }

    public isModelAvailable(model: T): boolean {
        const status = this.modelStatusMap.get(model.id);
        if (!status) return false;

        if (this.config.breaker.enabled) {
            if (status.circuitState === "OPEN") {
                if (status.openUntil && Date.now() > status.openUntil) {
                    // 恢复时间已到，进入半开状态
                    status.circuitState = "HALF_OPEN";
                    this.logger.info(`模型熔断器进入半开状态 | 模型: ${model.id}`);
                    return true;
                }
                return false; // 仍在熔断期
            }
            // CLOSED 或 HALF_OPEN 状态下都允许请求
            return true;
        }

        // 如果熔断器未启用，则始终认为可用
        return true;
    }

    /** 根据策略选择模型，传入可用模型列表 */
    protected selectModelByStrategy(models: T[]): T | null {
        if (models.length === 0) return null;
        if (models.length === 1) return models[0];

        switch (this.config.strategy) {
            case SwitchStrategy.RoundRobin:
                return this.selectRoundRobin(models);
            case SwitchStrategy.Failover:
                return this.selectFailover(models);
            case SwitchStrategy.Random:
                return this.selectRandom(models);
            case SwitchStrategy.WeightedRandom:
                return this.selectWeightedRandom(models);
            default:
                this.logger.warn(`未知的切换策略: ${(this.config as any).strategy}, 回退到第一个可用模型。`);
                return models[0];
        }
    }

    /** 选择轮询策略 */
    private selectRoundRobin(models: T[]): T {
        this.currentRoundRobinIndex = (this.currentRoundRobinIndex + 1) % models.length;
        return models[this.currentRoundRobinIndex];
    }

    /** 选择故障转移策略 */
    private selectFailover(models: T[]): T {
        // 优先选择成功率高、延迟低的模型
        return models.sort((a, b) => {
            const statusA = this.modelStatusMap.get(a.id)!;
            const statusB = this.modelStatusMap.get(b.id)!;
            if (statusB.successRate !== statusA.successRate) {
                return statusB.successRate - statusA.successRate;
            }
            return statusA.averageLatency - statusB.averageLatency; // 延迟越低越好
        })[0];
    }

    /** 选择随机策略 */
    private selectRandom(models: T[]): T {
        const randomIndex = Math.floor(Math.random() * models.length);
        return models[randomIndex];
    }

    /** 选择加权随机策略 */
    private selectWeightedRandom(models: T[]): T {
        const totalWeight = models.reduce((sum, model) => {
            const status = this.modelStatusMap.get(model.id)!;
            // 权重考虑配置权重和动态成功率
            return sum + status.weight * status.successRate;
        }, 0);

        if (totalWeight <= 0) return this.selectFailover(models); // 如果总权重为0，回退到 Failover

        let random = Math.random() * totalWeight;
        for (const model of models) {
            const status = this.modelStatusMap.get(model.id)!;
            const effectiveWeight = status.weight * status.successRate;
            if (random < effectiveWeight) {
                return model;
            }
            random -= effectiveWeight;
        }
        return models[models.length - 1]; // Fallback for floating point issues
    }

    public getModelStatus(model: T): ModelStatus {
        const status = this.modelStatusMap.get(model.id);
        if (!status) {
            throw new Error(`未找到模型状态信息: ${model.id}`);
        }
        return { ...status };
    }

    public getModels(): T[] {
        return this.models;
    }

    public recordResult(model: T, success: boolean, error?: ModelError, latency?: number) {
        const status = this.modelStatusMap.get(model.id);
        if (!status) return;

        status.totalRequests += 1;

        if (success) {
            status.successRequests += 1;
            status.lastSuccessTime = Date.now();

            // 如果处于半开状态，成功后关闭熔断器
            if (status.circuitState === "HALF_OPEN") {
                this.closeCircuit(status, model.id);
            }
            status.failureCount = 0; // 重置连续失败计数

            // 使用 EMA 更新平均延迟
            if (latency !== undefined) {
                if (status.averageLatency === 0) {
                    status.averageLatency = latency;
                } else {
                    status.averageLatency = EMA_ALPHA * latency + (1 - EMA_ALPHA) * status.averageLatency;
                }
            }
        } else {
            // Failure
            status.lastFailureTime = Date.now();
            status.failureCount += 1;

            // 如果处于半开状态，失败后重新打开熔断器
            if (this.config.breaker.enabled && status.circuitState === "HALF_OPEN") {
                this.tripCircuit(status, model.id, "半开状态探测失败");
            }
            // 如果处于关闭状态，检查是否达到熔断阈值
            else if (this.config.breaker.enabled && status.circuitState === "CLOSED") {
                if (status.failureCount >= this.config.breaker.threshold) {
                    this.tripCircuit(status, model.id, "达到失败阈值");
                }
            }
        }

        // 始终更新成功率
        status.successRate = status.totalRequests > 0 ? status.successRequests / status.totalRequests : 0;
    }

    /** 触发熔断器 (状态 -> OPEN) */
    private tripCircuit(status: ModelStatus, modelId: string, reason: string) {
        status.circuitState = "OPEN";
        status.openUntil = Date.now() + this.config.breaker.recoveryTime;
        this.logger.warn(`模型熔断器已触发 (OPEN) | 模型: ${modelId} | 原因: ${reason} | 恢复时间: ${this.config.breaker.recoveryTime}ms`);
    }

    /** 关闭熔断器 (状态 -> CLOSED) */
    private closeCircuit(status: ModelStatus, modelId: string) {
        status.circuitState = "CLOSED";
        status.failureCount = 0;
        delete status.openUntil;
        this.logger.info(`模型熔断器已恢复 (CLOSED) | 模型: ${modelId}`);
    }
}

/**
 * 专门用于聊天模型的切换器
 */
export class ChatModelSwitcher extends ModelSwitcher<IChatModel> {
    private readonly visionModels: IChatModel[] = [];
    private readonly nonVisionModels: IChatModel[] = [];

    constructor(
        logger: Logger,
        groupConfig: { name: string; models: ModelDescriptor[] },
        modelGetter: (providerName: string, modelId: string) => IChatModel | null,
        config: StrategyConfig
    ) {
        const allModels: IChatModel[] = [];
        const visionModels: IChatModel[] = [];
        const nonVisionModels: IChatModel[] = [];

        for (const descriptor of groupConfig.models) {
            const model = modelGetter(descriptor.providerName, descriptor.modelId);
            if (model) {
                allModels.push(model);
                if (model.isVisionModel?.()) {
                    visionModels.push(model);
                } else {
                    nonVisionModels.push(model);
                }
            } else {
                /* prettier-ignore */
                logger.warn(`⚠ 无法加载模型 | 提供商: ${descriptor.providerName} | 模型ID: ${descriptor.modelId} | 所属组: ${groupConfig.name}`);
            }
        }

        if (allModels.length === 0) {
            const errorMsg = `模型组 "${groupConfig.name}" 中无任何可用的模型，请检查配置。`;
            logger.error(`❌ 加载失败: ${errorMsg}`);
            throw new Error(errorMsg);
        }

        super(logger, allModels, config);
        this.visionModels = visionModels;
        this.nonVisionModels = nonVisionModels;
        /* prettier-ignore */
        logger.info(`✅ 模型组加载成功 | 组名: ${groupConfig.name} | 总模型数: ${allModels.length} | 视觉模型数: ${this.visionModels.length}`);
    }

    /**
     * @override
     * 根据请求类型获取合适的模型
     * @param type 模型类型 (vision / non_vision)
     * @returns 选中的模型，或 null
     */
    public getModel(type: ChatModelType = ChatModelType.All): IChatModel | null {
        let candidateModels: IChatModel[] = [];

        if (type === ChatModelType.Vision) {
            candidateModels = this.visionModels.filter((m) => this.isModelAvailable(m));
            if (candidateModels.length === 0 && this.nonVisionModels.length > 0) {
                this.logger.warn("所有视觉模型均不可用，尝试降级到普通模型");
                // FIXME: 这里应该返回 null, 让调用者决定是否降级
                candidateModels = this.nonVisionModels.filter((m) => this.isModelAvailable(m));
            }
        } else if (type === ChatModelType.NonVision) {
            candidateModels = this.nonVisionModels.filter((m) => this.isModelAvailable(m));
        } else {
            // 所有模型
            candidateModels = this.models.filter((m) => this.isModelAvailable(m));
        }

        if (candidateModels.length === 0) {
            // 如果特定类型模型全部不可用，尝试从所有模型中选择
            //this.logger.warn(`类型 "${type}" 的模型均不可用, 尝试从所有可用模型中选择。`);
            //candidateModels = this.models.filter((m) => this.isModelAvailable(m));
            return null;
        }

        return this.selectModelByStrategy(candidateModels);
    }

    /**
     * 检查此模型组是否具备处理视觉任务的能力
     */
    public hasVisionCapability(): boolean {
        let candidateModels: IChatModel[] = [];
        // FIXME: 放宽检测条件，不检查模型可用性
        candidateModels = this.visionModels.filter((model) => this.isModelAvailable(model));
        return candidateModels.length > 0;
    }

    /**
     * 执行聊天请求，内置重试和模型切换逻辑
     */
    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        const hasImages = this.hasImages(options.messages);

        if (hasImages && !this.hasVisionCapability()) {
            throw new ModelError(ModelErrorType.InvalidRequestError, "请求包含图片，但当前模型组不具备视觉能力。", undefined, false);
        }

        const initialModelType = hasImages ? ChatModelType.Vision : ChatModelType.NonVision;
        const maxRetries = this.config.maxRetries ?? 3;
        let lastError: ModelError | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const startTime = Date.now();
            const model = this.getModel(initialModelType);

            if (!model) {
                const errorMsg = lastError
                    ? `所有模型均不可用，最后错误: ${lastError.message}`
                    : "所有模型均不可用，请检查模型状态或配置。";
                throw new ModelError(lastError?.type || ModelErrorType.UnknownError, errorMsg, lastError?.originalError, false);
            }

            try {
                this.logger.debug(`[Attempt ${attempt + 1}/${maxRetries}] 使用模型: ${model.id}`);

                const requestOptions: ChatRequestOptions = { ...options };
                if (this.config.requestTimeout && this.config.requestTimeout > 0) {
                    const timeoutSignal = AbortSignal.timeout(this.config.requestTimeout);
                    requestOptions.abortSignal = options.abortSignal
                        ? AbortSignal.any([options.abortSignal, timeoutSignal])
                        : timeoutSignal;
                }

                const result = await model.chat(requestOptions);
                const latency = Date.now() - startTime;
                this.recordResult(model, true, undefined, latency);
                this.logger.debug(`模型调用成功 | 模型: ${model.id} | 延迟: ${latency}ms`);
                return result;
            } catch (error) {
                const latency = Date.now() - startTime;
                const modelError = ModelError.classify(error);
                lastError = modelError;

                this.recordResult(model, false, modelError, latency);
                this.logger.warn(`模型调用失败 | 模型: ${model.id} | 错误类型: ${modelError.type} | 消息: ${modelError.message}`);

                if (!modelError.canRetry()) {
                    this.logger.error(`发生不可重试的错误，终止请求: ${modelError.message}`);
                    throw modelError;
                }
            }
        }

        const finalErrorMsg = lastError ? `所有重试均失败，最后错误: ${lastError.message}` : "所有重试均失败";
        throw new ModelError(lastError?.type || ModelErrorType.UnknownError, finalErrorMsg, lastError?.originalError, false);
    }

    /** 检查消息列表中是否包含图片内容 */
    private hasImages(messages: Message[]): boolean {
        return messages.some((m) => Array.isArray(m.content) && m.content.some((p: any) => p && p.type === "image_url"));
    }
}
