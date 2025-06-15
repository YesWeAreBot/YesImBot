import { Context, sleep } from "koishi";
import { ChatModelSwitcher } from "../adapters";
import { LLMAdapterError, LLMRequestError, LLMRetryExhaustedError, LLMTimeoutError } from "../errors";
import { PromptBuilder } from "../prompt/PromptBuilder";
import { ConversationState, MessageContext, Middleware } from "./base";

/**
 * 重试配置
 */
export interface RetryConfig {
    maxRetries: number;
    timeoutMs: number;
    retryDelayMs: number;
    exponentialBackoff: boolean;
    retryableErrors: string[];
}

/**
 * 适配器切换配置
 */
export interface AdapterSwitchingConfig {
    enabled: boolean;
    maxAttempts: number;
}

/**
 * LLM重试管理器
 * 负责处理单个适配器的重试逻辑，包括超时控制和指数退避
 */
class LLMRetryManager {
    private readonly logger: any;

    constructor(private retryConfig: RetryConfig, private adapterConfig: AdapterSwitchingConfig, baseLogger: any) {
        this.logger = baseLogger("LLMRetryManager");
    }

    /**
     * 执行带重试的LLM请求
     */
    async executeWithRetry<T>(
        operation: (abortSignal: AbortSignal, cancelTimeout: () => void) => Promise<T>,
        adapterName: string
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            // 为每次请求创建独立的AbortController
            const controller = new AbortController();
            let timeoutId: NodeJS.Timeout | null = setTimeout(() => controller.abort(), this.retryConfig.timeoutMs);

            // 提供取消定时器的回调函数
            const cancelTimeout = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            try {
                this.logger.debug(`尝试请求 ${adapterName}，第 ${attempt + 1} 次`);

                const result = await operation(controller.signal, cancelTimeout);
                cancelTimeout(); // 确保定时器被清除

                if (attempt > 0) {
                    this.logger.info(`${adapterName} 重试成功，共尝试 ${attempt + 1} 次`);
                }

                return result;
            } catch (error: any) {
                cancelTimeout(); // 确保定时器被清除
                lastError = error;

                // 检查是否是中止错误
                if (error?.name === "AbortError") {
                    if (controller.signal.aborted) {
                        // 超时中止
                        const timeoutError = new LLMTimeoutError(
                            `请求超时 (${this.retryConfig.timeoutMs}ms)`,
                            this.retryConfig.timeoutMs,
                            adapterName
                        );

                        if (!this.isRetryableError(timeoutError)) {
                            throw timeoutError;
                        }
                        lastError = timeoutError;
                    } else {
                        // 外部中止，不重试
                        throw error;
                    }
                }

                // 检查是否可重试
                if (!this.isRetryableError(error)) {
                    this.logger.warn(`${adapterName} 遇到不可重试错误: ${error.message}`);
                    throw new LLMRequestError(error.message, adapterName, attempt, false, {}, error);
                }

                // 如果还有重试机会，等待后重试
                if (attempt < this.retryConfig.maxRetries) {
                    const delay = this.calculateRetryDelay(attempt);
                    this.logger.warn(
                        `${adapterName} 请求失败 (${error.message})，${delay}ms 后重试 (${attempt + 1}/${this.retryConfig.maxRetries})`
                    );
                    await sleep(delay);
                } else {
                    this.logger.error(`${adapterName} 重试耗尽，共尝试 ${attempt + 1} 次，最后错误: ${error.message}`);
                }
            }
        }

        // 所有重试都失败了
        throw new LLMRequestError(
            `重试耗尽: ${lastError?.message || "未知错误"}`,
            adapterName,
            this.retryConfig.maxRetries,
            true,
            {},
            lastError || undefined
        );
    }

    /**
     * 判断错误是否可重试
     */
    private isRetryableError(error: any): boolean {
        if (!error) return false;

        // 检查错误名称
        if (this.retryConfig.retryableErrors.includes(error.name)) {
            return true;
        }

        // 检查错误代码（网络错误）
        if (error.cause?.code && this.retryConfig.retryableErrors.includes(error.cause.code)) {
            return true;
        }

        // 检查特定的错误消息模式
        if (error.message) {
            const message = error.message.toLowerCase();
            if (
                message.includes("fetch failed") ||
                message.includes("network error") ||
                message.includes("timeout") ||
                message.includes("连接") ||
                message.includes("超时")
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * 计算重试延迟
     */
    private calculateRetryDelay(attempt: number): number {
        if (!this.retryConfig.exponentialBackoff) {
            return this.retryConfig.retryDelayMs;
        }

        // 指数退避：base * 2^attempt，加上随机抖动
        const exponentialDelay = this.retryConfig.retryDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 0.3 * exponentialDelay; // 30% 抖动
        return Math.min(exponentialDelay + jitter, 30000); // 最大30秒
    }
}

/**
 * LLM适配器管理器
 * 负责在多个适配器之间切换，实现故障转移
 */
class LLMAdapterManager {
    private failedAdapters: Set<string> = new Set();
    private currentIndex = 0;
    private readonly logger: any;

    constructor(private chatModelSwitcher: ChatModelSwitcher, private adapterConfig: AdapterSwitchingConfig, baseLogger: any) {
        this.logger = baseLogger("LLMAdapterManager");
    }

    /**
     * 执行带适配器切换的LLM请求
     */
    async executeWithAdapterSwitching<T>(operation: (adapterName: string, model: any) => Promise<T>): Promise<T> {
        if (!this.adapterConfig.enabled) {
            // 不启用适配器切换，直接使用当前适配器
            const model = this.chatModelSwitcher.getCurrent();
            if (!model) {
                throw new LLMAdapterError("没有可用的LLM适配器", "unknown", 0);
            }
            return await operation("current", model);
        }

        const totalAdapters = this.chatModelSwitcher.length;
        let attempt = 0;
        let lastError: Error | null = null;

        // 重置失败的适配器记录（每次新请求时）
        this.failedAdapters.clear();
        this.currentIndex = 0;

        while (attempt < this.adapterConfig.maxAttempts && attempt < totalAdapters) {
            // 尝试当前索引的适配器
            let model = this.chatModelSwitcher.getCurrent();

            // 如果当前适配器不可用，尝试切换
            if (!model && attempt < totalAdapters - 1) {
                this.switchToNextAdapter();
                model = this.chatModelSwitcher.getCurrent();
            }

            if (!model) {
                throw new LLMAdapterError("没有可用的LLM适配器", "unknown", totalAdapters);
            }

            const adapterName = this.getAdapterName(model);

            // 跳过已经失败的适配器（在同一次请求中）
            if (this.failedAdapters.has(adapterName)) {
                if (attempt < totalAdapters - 1) {
                    this.switchToNextAdapter();
                }
                attempt++;
                continue;
            }

            try {
                this.logger.debug(`使用适配器: ${adapterName} (尝试 ${attempt + 1}/${this.adapterConfig.maxAttempts})`);
                const result = await operation(adapterName, model);

                if (attempt > 0) {
                    this.logger.info(`适配器切换成功，使用 ${adapterName}`);
                }

                this.switchToNextAdapter();

                return result;
            } catch (error: any) {
                lastError = error;
                this.failedAdapters.add(adapterName);

                // 如果是不可重试的错误，直接抛出
                if (error instanceof LLMRequestError && !error.isRetryable) {
                    throw error;
                }

                this.logger.warn(`适配器 ${adapterName} 失败: ${error.message}`);

                // 切换到下一个适配器
                if (attempt < this.adapterConfig.maxAttempts - 1 && attempt < totalAdapters - 1) {
                    this.switchToNextAdapter();
                    this.logger.info(`切换到下一个适配器，剩余尝试次数: ${this.adapterConfig.maxAttempts - attempt - 1}`);
                }

                attempt++;
            }
        }

        // 所有适配器都失败了
        throw new LLMRetryExhaustedError(`所有LLM适配器都失败了`, attempt, Array.from(this.failedAdapters), lastError || undefined);
    }

    /**
     * 切换到下一个适配器
     */
    private switchToNextAdapter(): void {
        this.currentIndex = (this.currentIndex + 1) % this.chatModelSwitcher.length;
        this.chatModelSwitcher.switchToNext();
    }

    /**
     * 获取适配器名称
     */
    private getAdapterName(model: any): string {
        return model?.constructor?.name || model?.name || "unknown";
    }
}

export class LLMProcessingMiddleware extends Middleware {
    private retryManager: LLMRetryManager;
    private adapterManager: LLMAdapterManager;
    private readonly logger: any;

    constructor(
        protected ctx: Context,
        protected services: {
            readonly chatModelSwitcher: ChatModelSwitcher;
            readonly promptBuilder: PromptBuilder;
        },
        protected config: {
            debug?: boolean;
            retryConfig?: RetryConfig;
            adapterSwitchingConfig?: AdapterSwitchingConfig;
        }
    ) {
        super("llm-processing", ctx, services, config);

        // 创建带前缀的logger
        this.logger = this.ctx.logger("LLMProcessing");

        // 使用默认配置
        const defaultRetryConfig: RetryConfig = {
            maxRetries: 3,
            timeoutMs: 30000,
            retryDelayMs: 1000,
            exponentialBackoff: true,
            retryableErrors: [
                "ECONNREFUSED",
                "ECONNRESET",
                "ETIMEDOUT",
                "ENOTFOUND",
                "EPIPE",
                "XSAIError",
                "NetworkError",
                "TimeoutError",
                "AbortError",
            ],
        };

        const defaultAdapterConfig: AdapterSwitchingConfig = {
            enabled: true,
            maxAttempts: 3,
        };

        this.retryManager = new LLMRetryManager(
            config.retryConfig || defaultRetryConfig,
            config.adapterSwitchingConfig || defaultAdapterConfig,
            this.ctx.logger
        );

        this.adapterManager = new LLMAdapterManager(
            this.services.chatModelSwitcher,
            config.adapterSwitchingConfig || defaultAdapterConfig,
            this.ctx.logger
        );
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        if (ctx.state !== ConversationState.PROCESSING) {
            return await next();
        }

        try {
            // 构建提示词
            const systemPrompt = await this.services.promptBuilder.buildSystemPrompt(ctx);
            const userPrompt = await this.services.promptBuilder.buildUserPrompt(ctx);

            if (this.config.debug) {
                this.logger.debug("--- LLM System Prompt ---");
                this.logger.debug(systemPrompt);
                this.logger.debug("--- LLM User Prompt ---");
                this.logger.debug(JSON.stringify(userPrompt, null, 2));
                this.logger.debug("--- End Prompts ---");
            }

            // 执行LLM请求（带适配器切换和重试）
            ctx.llmResponse = await this.adapterManager.executeWithAdapterSwitching(async (adapterName: string, model: any) => {
                return await this.retryManager.executeWithRetry(async (abortSignal: AbortSignal, cancelTimeout: () => void) => {
                    return await model.chat(
                        [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                        ],
                        null,
                        {
                            debug: this.config.debug,
                            logger: ctx.koishiContext.logger,
                            abortSignal,
                            onStreamStart: cancelTimeout, // 当流式响应开始时取消定时器
                        }
                    );
                }, adapterName);
            });

            await ctx.transitionTo(ConversationState.RESPONDING);
            await next();
        } catch (error: any) {
            // 处理不同类型的错误
            if (error instanceof LLMRetryExhaustedError) {
                this.logger.error(error.toUserMessage());
                this.logger.error(`错误详情: ${error.toLogFormat()}`);
            } else if (error instanceof LLMTimeoutError) {
                this.logger.warn(error.toUserMessage());
            } else if (error instanceof LLMRequestError) {
                this.logger.warn(error.toUserMessage());
            } else if (error?.name === "AbortError") {
                // 外部中止请求，静默处理
                this.logger.info("请求被外部中止");
                return;
            } else {
                // 其他未知错误
                this.logger.error(`未预期的错误: ${error?.message || "未知错误"}`);
            }

            throw error;
        }
    }
}
