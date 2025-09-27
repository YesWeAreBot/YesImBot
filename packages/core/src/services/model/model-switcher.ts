import type { GenerateTextResult } from "@xsai/generate-text";
import type { Message } from "@xsai/shared-chat";
import { Logger } from "koishi";

import { BaseModel } from "./base-model";
import { ChatRequestOptions, IChatModel } from "./chat-model";
import { ModelDescriptor, StrategyConfig } from "./config";
import { ChatModelType, ModelError, ModelErrorType, ModelStatus, SwitchStrategy } from "./types";

export interface IModelSwitcher<T extends BaseModel> {
    /** 获取一个可用模型 */
    getModel(): T | null;

    /** 获取所有模型 */
    getModels(): T[];

    /** 获取模型状态 */
    getModelStatus(model: T): ModelStatus;

    /** 检查模型是否可用 */
    isModelAvailable(model: T): boolean;

    /** 记录一次调用结果 */
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
        // 初始化健康状态
        for (const model of this.models) {
            this.modelStatusMap.set(model.id, {
                isHealthy: true,
                failureCount: 0,
                averageLatency: 0,
                totalRequests: 0,
                successRequests: 0,
                failureRequests: 0,
                successRate: 1.0,
                weight: this.config.strategy === SwitchStrategy.WeightedRandom ? (this.config as any).weights?.[model.id] || 1 : 1,
                isCircuitBroken: false,
            });
        }
    }

    public getModel(): T | null {
        const healthyModels = this.models.filter((model) => this.isModelAvailable(model));

        if (healthyModels.length === 0) {
            return null;
        }

        return this.selectModelByStrategy(healthyModels);
    }

    public isModelAvailable(model: T): boolean {
        const health = this.modelStatusMap.get(model.id);
        if (!health) return false;

        const now = Date.now();

        // 检查熔断状态
        if (health.isCircuitBroken) {
            if (health.circuitBreakerResetTime && now > health.circuitBreakerResetTime) {
                // 熔断器恢复
                health.isCircuitBroken = false;
                health.failureCount = 0;
                delete health.circuitBreakerResetTime;
                this.logger.info(`模型熔断器已恢复 | 模型: ${model.id}`);
                return true;
            }
            return false;
        }

        if (this.config.breaker.enabled) {
            // 检查失败冷却
            if (health.failureCount >= this.config.breaker.maxFailures && health.lastFailureTime) {
                const cooldownExpired = now - health.lastFailureTime > this.config.breaker.cooldown;
                if (!cooldownExpired) {
                    return false;
                }
                // 冷却期已过，重置失败计数
                health.failureCount = 0;
                health.isHealthy = true;
                this.logger.info(`模型冷却期已过，重新可用 | 模型: ${model.id}`);
            }
        }

        return health.isHealthy;
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
                return models[0];
        }
    }

    /** 选择轮询策略 */
    private selectRoundRobin(models: T[]): T {
        const model = models[this.currentRoundRobinIndex % models.length];
        this.currentRoundRobinIndex = (this.currentRoundRobinIndex + 1) % models.length;
        return model;
    }

    /** 选择故障转移策略 */
    private selectFailover(models: T[]): T {
        // 按健康度排序，优先选择成功率高的模型
        const sortedModels = models.sort((a, b) => {
            const healthA = this.modelStatusMap.get(a.id)!;
            const healthB = this.modelStatusMap.get(b.id)!;
            return healthB.successRate - healthA.successRate;
        });
        return sortedModels[0];
    }

    /** 选择随机策略 */
    private selectRandom(models: T[]): T {
        const randomIndex = Math.floor(Math.random() * models.length);
        return models[randomIndex];
    }

    /** 选择加权随机策略 */
    private selectWeightedRandom(models: T[]): T {
        const weights = models.map((model) => {
            const health = this.modelStatusMap.get(model.id)!;
            return health.weight * health.successRate;
        });

        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        if (totalWeight === 0) return models[0];

        let random = Math.random() * totalWeight;
        for (let i = 0; i < models.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return models[i];
            }
        }
        return models[models.length - 1];
    }

    public getModelStatus(model: T): ModelStatus {
        const health = this.modelStatusMap.get(model.id);
        if (!health) {
            throw new Error(`未找到模型健康信息: ${model.id}`);
        }
        return { ...health };
    }

    public getModels(): T[] {
        return this.models;
    }

    public recordResult(model: T, success: boolean, error?: ModelError, latency?: number) {
        const health = this.modelStatusMap.get(model.id);
        if (!health) return;

        health.totalRequests += 1;
        if (success) {
            health.successRequests += 1;
            health.failureCount = 0; // 重置连续失败计数
            health.isHealthy = true;

            // 更新平均延迟
            if (latency !== undefined) {
                health.averageLatency = (health.averageLatency * (health.successRequests - 1) + latency) / health.successRequests;
            }
        } else {
            health.failureRequests += 1;
            health.failureCount += 1;
            health.lastFailureTime = Date.now();

            // 更新成功率
            health.successRate = health.successRequests / health.totalRequests;

            if (this.config.breaker.enabled) {
                // 检查是否需要触发熔断
                if (health.failureCount >= this.config.breaker.threshold) {
                    health.isCircuitBroken = true;
                    health.circuitBreakerResetTime = Date.now() + this.config.breaker.recoveryTime;
                    this.logger.warn(`模型熔断器已触发 | 模型: ${model.id} | 熔断持续时间: ${this.config.breaker.recoveryTime}ms`);
                }
            }

            // 如果是超时或服务器错误，可能需要更新平均延迟
            if (latency !== undefined && (error?.type === ModelErrorType.TimeoutError || error?.type === ModelErrorType.ServerError)) {
                health.averageLatency =
                    (health.averageLatency * (health.successRequests + health.failureRequests - 1) + latency) /
                    (health.successRequests + health.failureRequests);
            }
        }
    }
}

/**
 * 专门用于聊天模型的切换器
 * 继承基础切换器功能，添加视觉模型处理逻辑
 */
export class ChatModelSwitcher extends ModelSwitcher<IChatModel> {
    private readonly visionModels: IChatModel[] = [];
    private readonly nonVisionModels: IChatModel[] = [];
    constructor(
        protected readonly logger: Logger,
        groupConfig: { name: string; models: ModelDescriptor[] },
        modelGetter: (providerName: string, modelId: string) => IChatModel | null,
        config: StrategyConfig
    ) {
        // 加载所有可用模型
        const allModels: IChatModel[] = [];
        const visionModels: IChatModel[] = [];
        const nonVisionModels: IChatModel[] = [];

        for (const descriptor of groupConfig.models) {
            const model = modelGetter(descriptor.providerName, descriptor.modelId);
            if (model) {
                allModels.push(model);

                // 根据模型能力分类
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
            const errorMsg = "模型组中无任何可用的模型 (请检查模型配置和能力声明)";
            logger.error(`❌ 加载失败 | ${errorMsg}`);
            throw new Error(`模型组 "${groupConfig.name}" 初始化失败: ${errorMsg}`);
        }

        super(logger, allModels, config);

        this.visionModels = visionModels;
        this.nonVisionModels = nonVisionModels;

        /* prettier-ignore */
        logger.info(`✅ 模型组加载成功 | 组名: ${groupConfig.name} | 总模型数: ${allModels.length} | 视觉模型数: ${visionModels.length} | 普通模型数: ${nonVisionModels.length}`);
    }

    /**
     * @override
     *
     * 根据模型类型获取合适的模型
     * @param type 模型类型
     * @returns 选中的模型，如果没有可用模型则返回 null
     */
    public getModel(type?: ChatModelType): IChatModel | null {
        let candidateModels: IChatModel[] = [];

        if (type === ChatModelType.Vision) {
            candidateModels = this.visionModels.filter((model) => this.isModelAvailable(model));
            if (candidateModels.length === 0) {
                this.logger.warn("所有视觉模型均不可用，尝试降级到普通模型");
                candidateModels = this.nonVisionModels.filter((model) => this.isModelAvailable(model));
            }
        } else if (type === ChatModelType.NonVision) {
            candidateModels = this.nonVisionModels.filter((model) => this.isModelAvailable(model));
        } else {
            // 未指定类型，优先选择视觉模型
            candidateModels = this.models.filter((model) => this.isModelAvailable(model));
        }

        if (candidateModels.length === 0) {
            return null;
        }

        return this.selectModelByStrategy(candidateModels);
    }

    /**
     * 检查此模型组中是否有视觉模型
     */
    public hasVisionCapability(): boolean {
        let candidateModels: IChatModel[] = [];
        // FIXME: 放宽检测条件，不检查模型可用性
        candidateModels = this.visionModels.filter((model) => this.isModelAvailable(model));
        return candidateModels.length > 0;
    }

    /**
     * 带内部重试机制的聊天接口
     * @param options
     * @returns
     */
    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        // 检测是否包含图片
        const hasImages = this.hasImages(options.messages);
        let modelType = hasImages ? ChatModelType.Vision : ChatModelType.NonVision;

        const maxRetries = this.config.maxRetries;
        let attempt = 0;
        let lastError: ModelError | null = null;

        while (attempt < maxRetries) {
            const startTime = Date.now();
            const model = this.getModel(modelType);

            if (!model) {
                if (modelType === ChatModelType.Vision && hasImages) {
                    // 视觉模型全部不可用，降级到普通模型
                    this.logger.warn("所有视觉模型均不可用，降级到普通模型处理");
                    modelType = ChatModelType.NonVision;
                    continue;
                } else {
                    // 所有模型都不可用
                    const errorMsg = lastError ? `所有模型均不可用，最后错误: ${lastError.message}` : "所有模型均不可用";
                    throw new ModelError(lastError?.type || ModelErrorType.UnknownError, errorMsg, lastError?.originalError, false);
                }
            }

            try {
                this.logger.debug(`尝试使用模型 | 模型: ${model.id} | 尝试次数: ${attempt + 1}`);

                // 创建带超时的请求选项
                const requestOptions = { ...options };
                if (this.config.requestTimeout > 0) {
                    const timeoutSignal = AbortSignal.timeout(this.config.requestTimeout);
                    if (requestOptions.abortSignal) {
                        requestOptions.abortSignal = AbortSignal.any([requestOptions.abortSignal, timeoutSignal]);
                    } else {
                        requestOptions.abortSignal = timeoutSignal;
                    }
                }

                // 执行请求
                const result = await model.chat(requestOptions);
                const latency = Date.now() - startTime;

                // 记录成功结果
                this.recordResult(model, true, undefined, latency);

                this.logger.debug(`模型调用成功 | 模型: ${model.id} | 延迟: ${latency}ms`);
                return result;
            } catch (error) {
                const latency = Date.now() - startTime;
                const modelError = error instanceof ModelError ? error : ModelError.classify(error as Error);

                // 记录失败结果
                this.recordResult(model, false, modelError, latency);
                lastError = modelError;

                this.logger.warn(`模型调用失败 | 模型: ${model.id} | 错误: ${modelError.message} | 可重试: ${modelError.canRetry()}`);

                // 如果是不可重试的错误，直接抛出
                if (!modelError.canRetry()) {
                    throw modelError;
                }

                attempt++;
            }
        }

        // 所有重试都失败了
        const errorMsg = lastError ? `所有重试都失败了，最后错误: ${lastError.message}` : "所有重试都失败了";
        throw new ModelError(lastError?.type || ModelErrorType.UnknownError, errorMsg, lastError?.originalError, false);
    }

    /** 检查消息列表中是否包含图片 */
    private hasImages(messages: Message[]): boolean {
        return messages.some((m) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"));
    }
}
