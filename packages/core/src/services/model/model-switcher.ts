import { GenerateTextResult } from "@xsai/generate-text";
import { Context, Logger } from "koishi";

import { BaseModel } from "./base-model";
import { ChatRequestOptions, IChatModel } from "./chat-model";
import { ModelDescriptor, StrategyConfig } from "./config";
import { ChatModelType, ModelError, ModelErrorType, ModelHealthInfo, SwitchStrategy } from "./types";

export interface IModelSwitcher<T extends BaseModel> {
    /** 获取一个可用模型（外部控制重试） */
    pickModel(modelType?: ChatModelType): T | null;

    /** 统一的聊天接口（内部自动重试所有可用模型） */
    chat(options: ChatRequestOptions): Promise<GenerateTextResult>;

    /** 记录模型执行结果 */
    recordResult(model: T, success: boolean, error?: ModelError, latency?: number): void;

    /** 获取模型健康状态 */
    getModelHealth(model: T): ModelHealthInfo;

    /** 获取所有模型 */
    getModels(): T[];
}

export class ModelSwitcher<T extends BaseModel> implements IModelSwitcher<T> {
    protected currentRoundRobinIndex: number = 0;
    protected readonly modelHealthMap = new Map<string, ModelHealthInfo>();

    constructor(
        protected readonly logger: Logger,
        protected readonly models: T[],
        protected readonly visionModels: T[],
        protected readonly nonVisionModels: T[],
        protected config: StrategyConfig
    ) {
        // 初始化健康状态
        this.initializeHealthStates();

        this.logger.info(
            `模型切换器已初始化 | 策略: ${this.config.strategy} | 总模型数: ${this.models.length} | 视觉模型: ${this.visionModels.length} | 普通模型: ${this.nonVisionModels.length}`
        );
    }

    private initializeHealthStates(): void {
        for (const model of this.models) {
            this.modelHealthMap.set(model.id, {
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

    public pickModel(modelType: ChatModelType = ChatModelType.All): T | null {
        const candidateModels = this.getCandidateModels(modelType);
        const healthyModels = candidateModels.filter((model) => this.isModelHealthy(model));

        if (healthyModels.length === 0) {
            this.logger.warn(`没有可用的健康模型 | 请求类型: ${modelType}`);
            return null;
        }

        return this.selectModelByStrategy(healthyModels);
    }

    protected getCandidateModels(modelType: ChatModelType): T[] {
        switch (modelType) {
            case ChatModelType.Vision:
                return this.visionModels;
            case ChatModelType.NonVision:
                return this.nonVisionModels;
            case ChatModelType.All:
            default:
                return this.models;
        }
    }

    private isModelHealthy(model: T): boolean {
        const health = this.modelHealthMap.get(model.id);
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

        // 检查失败冷却
        if (health.failureCount >= this.config.maxFailures && health.lastFailureTime) {
            const cooldownExpired = now - health.lastFailureTime > this.config.failureCooldown;
            if (!cooldownExpired) {
                return false;
            }
            // 冷却期已过，重置失败计数
            health.failureCount = 0;
            health.isHealthy = true;
            this.logger.info(`模型冷却期已过，重新可用 | 模型: ${model.id}`);
        }

        return health.isHealthy;
    }

    private selectModelByStrategy(models: T[]): T | null {
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

    private selectRoundRobin(models: T[]): T {
        const model = models[this.currentRoundRobinIndex % models.length];
        this.currentRoundRobinIndex = (this.currentRoundRobinIndex + 1) % models.length;
        return model;
    }

    private selectFailover(models: T[]): T {
        // 按健康度排序，优先选择成功率高的模型
        const sortedModels = models.sort((a, b) => {
            const healthA = this.modelHealthMap.get(a.id)!;
            const healthB = this.modelHealthMap.get(b.id)!;
            return healthB.successRate - healthA.successRate;
        });
        return sortedModels[0];
    }

    private selectRandom(models: T[]): T {
        const randomIndex = Math.floor(Math.random() * models.length);
        return models[randomIndex];
    }

    private selectWeightedRandom(models: T[]): T {
        const weights = models.map((model) => {
            const health = this.modelHealthMap.get(model.id)!;
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

    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        // 检测是否包含图片
        const hasImages = this.hasImagesInMessages(options.messages);
        let modelType = hasImages ? ChatModelType.Vision : ChatModelType.NonVision;

        const startTime = Date.now();
        const maxRetries = this.models.length * 2; // 允许重试所有模型两轮
        let attempt = 0;
        let lastError: ModelError | null = null;

        while (attempt < maxRetries) {
            const model = this.pickModel(modelType);

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
                    const timeoutController = new AbortController();
                    const timeoutId = setTimeout(() => timeoutController.abort(), this.config.requestTimeout);

                    if (requestOptions.abortSignal) {
                        // 合并现有的abort signal
                        const combinedController = new AbortController();
                        const cleanup = () => {
                            clearTimeout(timeoutId);
                            timeoutController.abort();
                            combinedController.abort();
                        };

                        requestOptions.abortSignal.addEventListener("abort", cleanup);
                        timeoutController.signal.addEventListener("abort", cleanup);
                        requestOptions.abortSignal = combinedController.signal;
                    } else {
                        requestOptions.abortSignal = timeoutController.signal;
                        // 确保清理超时
                        requestOptions.abortSignal.addEventListener("abort", () => clearTimeout(timeoutId));
                    }
                }

                // 执行请求
                const result = await (model as any).chat(requestOptions);
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

    private hasImagesInMessages(messages: any[]): boolean {
        return messages.some((m) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"));
    }

    public recordResult(model: T, success: boolean, error?: ModelError, latency?: number): void {
        const health = this.modelHealthMap.get(model.id);
        if (!health) return;

        const now = Date.now();
        health.totalRequests++;

        if (success) {
            health.successRequests++;
            health.failureCount = 0;
            health.lastSuccessTime = now;
            health.isHealthy = true;

            // 更新平均延迟
            if (latency !== undefined) {
                health.averageLatency = health.averageLatency === 0 ? latency : (health.averageLatency + latency) / 2;
            }
        } else {
            health.failureRequests++;
            health.failureCount++;
            health.lastFailureTime = now;

            // 检查是否需要标记为不健康
            if (health.failureCount >= this.config.maxFailures) {
                health.isHealthy = false;
                this.logger.warn(`模型标记为不健康 | 模型: ${model.id} | 连续失败: ${health.failureCount}次`);
            }

            // 检查是否需要触发熔断
            if (health.failureCount >= this.config.circuitBreakerThreshold) {
                health.isCircuitBroken = true;
                health.circuitBreakerResetTime = now + this.config.circuitBreakerRecoveryTime;
                this.logger.warn(
                    `模型熔断器触发 | 模型: ${model.id} | 恢复时间: ${new Date(health.circuitBreakerResetTime).toISOString()}`
                );
            }
        }

        // 更新成功率
        health.successRate = health.totalRequests > 0 ? health.successRequests / health.totalRequests : 1.0;
    }

    public getModelHealth(model: T): ModelHealthInfo {
        const health = this.modelHealthMap.get(model.id);
        if (!health) {
            throw new Error(`未找到模型健康信息: ${model.id}`);
        }
        return { ...health };
    }

    public getModels(): T[] {
        return this.models;
    }

    public getHealthySummary(): { total: number; healthy: number; broken: number } {
        let healthy = 0;
        let broken = 0;

        for (const health of this.modelHealthMap.values()) {
            if (health.isCircuitBroken) {
                broken++;
            } else if (health.isHealthy) {
                healthy++;
            }
        }

        return {
            total: this.models.length,
            healthy,
            broken,
        };
    }
}

/**
 * 专门用于聊天模型的切换器
 * 继承基础切换器功能，添加视觉模型处理逻辑
 */
export class ChatModelSwitcher extends ModelSwitcher<IChatModel> implements IModelSwitcher<IChatModel> {
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
                logger.warn(
                    `⚠ 无法加载模型 | 提供商: ${descriptor.providerName} | 模型ID: ${descriptor.modelId} | 所属组: ${groupConfig.name}`
                );
            }
        }

        if (allModels.length === 0) {
            const errorMsg = "模型组中无任何可用的模型 (请检查模型配置和能力声明)";
            logger.error(`❌ 加载失败 | ${errorMsg}`);
            throw new Error(`模型组 "${groupConfig.name}" 初始化失败: ${errorMsg}`);
        }

        super(logger, allModels, visionModels, nonVisionModels, config);

        logger.success(
            `✅ 聊天模型切换器初始化成功 | 组名: ${groupConfig.name} | 总模型数: ${allModels.length} | 视觉模型: ${visionModels.length} | 普通模型: ${nonVisionModels.length}`
        );
    }

    /**
     * 根据模型类型获取合适的模型
     * @param type 模型类型
     * @returns 选中的模型，如果没有可用模型则返回 null
     */
    public getModel(type?: ChatModelType): IChatModel | null {
        return this.pickModel(type || ChatModelType.All);
    }

    /**
     * 检查是否有视觉能力
     * @returns 是否有视觉模型可用
     */
    public hasVisionCapability(): boolean {
        return this.visionModels.length > 0;
    }

    /**
     * 获取推荐使用的模型（基于成功率和延迟）
     * @param modelType 模型类型
     * @returns 推荐模型信息
     */
    public getRecommendedModel(modelType: ChatModelType = ChatModelType.All): {
        model: IChatModel;
        health: ModelHealthInfo;
        score: number;
    } | null {
        const candidates = this.getCandidateModelsForType(modelType);
        if (candidates.length === 0) return null;

        let bestModel: IChatModel | null = null;
        let bestScore = -1;
        let bestHealth: ModelHealthInfo | null = null;

        for (const model of candidates) {
            const health = this.getModelHealth(model);
            if (!health.isHealthy || health.isCircuitBroken) continue;

            // 计算综合得分：成功率 * 权重 - 平均延迟影响
            const latencyFactor = health.averageLatency > 0 ? Math.max(0.1, 1 - health.averageLatency / 10000) : 1;
            const score = health.successRate * health.weight * latencyFactor;

            if (score > bestScore) {
                bestScore = score;
                bestModel = model;
                bestHealth = health;
            }
        }

        return bestModel && bestHealth
            ? {
                  model: bestModel,
                  health: bestHealth,
                  score: bestScore,
              }
            : null;
    }

    private getCandidateModelsForType(modelType: ChatModelType): IChatModel[] {
        switch (modelType) {
            case ChatModelType.Vision:
                return this.visionModels;
            case ChatModelType.NonVision:
                return this.nonVisionModels;
            case ChatModelType.All:
            default:
                return this.models;
        }
    }
}
