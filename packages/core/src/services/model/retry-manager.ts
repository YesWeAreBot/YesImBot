import { sleep, Logger, Context } from "koishi";
import { LLMRequestError, LLMTimeoutError } from "../../shared/errors";

// 定义可重试错误类型
export type RetryableError = Error & {
    name?: string; // e.g., 'AbortError'
    code?: string; // e.g., 'ECONNREFUSED'
    cause?: { code?: string }; // For undici/fetch errors
};

// RetryManager 的配置
export interface RetryConfig {
    maxRetries: number;
    timeoutMs: number;
    retryDelayMs: number;
    exponentialBackoff: boolean;
    retryableErrors: string[]; // 包含错误 name 或 code
}

export class LLMRetryManager {
    // 默认重试配置
    private readonly defaultRetryConfig: RetryConfig = {
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

    // 合并后的配置
    public readonly config: RetryConfig;
    private logger: Logger;

    constructor(ctx: Context, retryConfig: Partial<RetryConfig>) {
        this.config = { ...this.defaultRetryConfig, ...retryConfig };
        this.logger = ctx.logger("model").extend("retry-manager");
        this.logger.info(`重试管理器配置: ${JSON.stringify(this.config)}`);
    }

    /**
     * 执行带重试和超时的操作。
     * @param operation - 要执行的操作函数，接收 AbortSignal 和 cancelTimeout 回调。
     * @param adapterName - 当前正在尝试的模型/适配器名称，用于日志记录。
     * @returns 操作的结果。
     * @throws 如果所有重试都失败或遇到不可重试错误。
     */
    public async executeWithRetry<T>(
        operation: (abortSignal: AbortSignal, cancelTimeout: () => void) => Promise<T>,
        adapterName: string
    ): Promise<T> {
        let lastError: RetryableError | null = null;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            const controller = new AbortController();
            let timeoutId: NodeJS.Timeout | null = null;

            // 设置总超时
            timeoutId = setTimeout(() => {
                this.logger.warn(`请求 "${adapterName}" 第 ${attempt + 1} 次超时 (${this.config.timeoutMs}ms)`);
                controller.abort();
            }, this.config.timeoutMs);

            const cancelTimeout = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            try {
                this.logger.debug(`尝试请求 "${adapterName}"，第 ${attempt + 1} 次 (配置超时: ${this.config.timeoutMs}ms)`);
                const result = await operation(controller.signal, cancelTimeout);
                cancelTimeout(); // 成功后取消超时

                if (attempt > 0) {
                    this.logger.info(`"${adapterName}" 重试成功，共尝试 ${attempt + 1} 次。`);
                }
                return result;
            } catch (error: any) {
                cancelTimeout(); // 发生错误后取消超时
                lastError = error;

                // 检查是否是超时中止
                if (error?.name === "AbortError" && controller.signal.aborted) {
                    // 如果是AbortError且由我们的超时触发，抛出自定义超时错误
                    const timeoutError = new LLMTimeoutError(`请求超时 (${this.config.timeoutMs}ms)`, this.config.timeoutMs, adapterName);
                    if (!this.isRetryableError(timeoutError)) {
                        throw timeoutError; // 如果当前场景下超时不可重试，则直接抛出
                    }
                    lastError = timeoutError;
                }

                // 检查错误是否可重试
                if (!this.isRetryableError(error)) {
                    this.logger.warn(`"${adapterName}" 遇到不可重试错误: ${error.message || error}`);
                    throw new LLMRequestError(error.message || "不可重试错误", adapterName, attempt, false, {}, error);
                }

                // 如果还有重试机会，等待后重试
                if (attempt < this.config.maxRetries) {
                    const delay = this.calculateRetryDelay(attempt);
                    this.logger.warn(
                        `"${adapterName}" 请求失败 (${error.message || error})，${delay}ms 后重试 (${attempt + 1}/${
                            this.config.maxRetries
                        })`
                    );
                    await sleep(delay);
                } else {
                    this.logger.error(`"${adapterName}" 重试耗尽，共尝试 ${attempt + 1} 次，最后错误: ${error.message || error}`);
                }
            }
        }

        // 所有重试都失败了
        throw new LLMRequestError(
            `重试耗尽: ${lastError?.message || "未知错误"}`,
            adapterName,
            this.config.maxRetries,
            true, // isRetryable = true, 因为是耗尽
            {},
            lastError || undefined
        );
    }

    /**
     * 判断错误是否属于可重试的范围。
     */
    private isRetryableError(error: RetryableError): boolean {
        if (!error) return false;

        // 检查错误名称 (e.g., 'AbortError', 'NetworkError')
        if (error.name && this.config.retryableErrors.includes(error.name)) {
            return true;
        }

        // 检查错误代码 (e.g., 'ECONNREFUSED', 'ETIMEDOUT')
        if (error.code && this.config.retryableErrors.includes(error.code)) {
            return true;
        }
        if (error.cause?.code && this.config.retryableErrors.includes(error.cause.code)) {
            return true;
        }

        // 检查特定的错误消息模式 (作为后备)
        if (error.message) {
            const message = error.message.toLowerCase();
            if (
                message.includes("fetch failed") ||
                message.includes("network error") ||
                message.includes("timeout") ||
                message.includes("连接") || // 中文错误信息
                message.includes("超时")
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * 计算下一次重试的延迟时间（带指数退避和抖动）。
     */
    private calculateRetryDelay(attempt: number): number {
        if (!this.config.exponentialBackoff) {
            return this.config.retryDelayMs;
        }

        // 指数退避: delay = baseDelay * 2^attempt + randomJitter
        const exponentialDelay = this.config.retryDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 0.3 * exponentialDelay; // 30% 的随机抖动
        const calculatedDelay = exponentialDelay + jitter;

        // 限制最大延迟，防止延迟过长
        const maxDelay = 30000; // 例如，最多延迟 30 秒
        return Math.min(calculatedDelay, maxDelay);
    }
}
