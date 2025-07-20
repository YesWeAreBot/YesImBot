/**
 * 重试管理器
 * 
 * 提供灵活的重试机制，支持多种重试策略和错误处理。
 * 
 * ## 重试策略
 * 
 * ### FIXED（固定延迟）
 * - 每次重试之间的延迟时间固定
 * - 适用于网络抖动等临时性问题
 * 
 * ### EXPONENTIAL（指数退避）
 * - 每次重试的延迟时间呈指数增长
 * - 适用于服务过载等需要逐渐减少压力的场景
 * 
 * ### LINEAR（线性增长）
 * - 每次重试的延迟时间线性增长
 * - 适用于需要逐步增加等待时间的场景
 * 
 * ## 使用示例
 * 
 * ```typescript
 * const retryManager = new RetryManager({
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   strategy: RetryStrategy.EXPONENTIAL,
 *   maxDelayMs: 10000
 * });
 * 
 * const result = await retryManager.execute(async () => {
 *   return await someUnreliableOperation();
 * });
 * 
 * if (result.success) {
 *   console.log('操作成功:', result.data);
 *   console.log('重试次数:', result.attempts);
 * } else {
 *   console.log('操作失败:', result.error);
 * }
 * ```
 */

export enum RetryStrategy {
    FIXED = 'FIXED',
    EXPONENTIAL = 'EXPONENTIAL',
    LINEAR = 'LINEAR'
}

export interface RetryConfig {
    /** 最大重试次数 */
    maxRetries: number;
    /** 基础延迟时间（毫秒） */
    baseDelayMs: number;
    /** 重试策略 */
    strategy: RetryStrategy;
    /** 最大延迟时间（毫秒） */
    maxDelayMs?: number;
    /** 指数退避的倍数（仅用于 EXPONENTIAL 策略） */
    backoffMultiplier?: number;
    /** 是否应该重试的判断函数 */
    shouldRetry?: (error: Error, attempt: number) => boolean;
}

export interface RetryResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    attempts: number;
    totalTimeMs: number;
    lastAttemptTimeMs?: number;
}

interface AttemptInfo {
    attempt: number;
    startTime: number;
    error?: Error;
}

export class RetryManager {
    private readonly config: Required<RetryConfig>;

    constructor(config: RetryConfig) {
        this.config = {
            maxDelayMs: 30000, // 默认最大延迟30秒
            backoffMultiplier: 2, // 默认指数倍数为2
            shouldRetry: () => true, // 默认总是重试
            ...config
        };
    }

    /**
     * 执行带重试的操作
     */
    async execute<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
        const startTime = Date.now();
        const attempts: AttemptInfo[] = [];
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
            const attemptStartTime = Date.now();
            
            try {
                const result = await operation();
                const totalTime = Date.now() - startTime;
                const lastAttemptTime = Date.now() - attemptStartTime;

                return {
                    success: true,
                    data: result,
                    attempts: attempt,
                    totalTimeMs: totalTime,
                    lastAttemptTimeMs: lastAttemptTime
                };
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                lastError = err;
                
                attempts.push({
                    attempt,
                    startTime: attemptStartTime,
                    error: err
                });

                // 如果是最后一次尝试，或者不应该重试，则停止
                if (attempt > this.config.maxRetries || !this.config.shouldRetry(err, attempt)) {
                    break;
                }

                // 计算延迟时间并等待
                const delay = this.calculateDelay(attempt);
                await this.sleep(delay);
            }
        }

        const totalTime = Date.now() - startTime;
        const lastAttemptTime = attempts.length > 0 
            ? Date.now() - attempts[attempts.length - 1].startTime 
            : undefined;

        return {
            success: false,
            error: lastError?.message || '未知错误',
            attempts: attempts.length,
            totalTimeMs: totalTime,
            lastAttemptTimeMs: lastAttemptTime
        };
    }

    /**
     * 获取配置信息
     */
    getConfig(): Readonly<RetryConfig> {
        return { ...this.config };
    }

    /**
     * 预计算延迟时间序列
     */
    getDelaySequence(): number[] {
        const delays: number[] = [];
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            delays.push(this.calculateDelay(attempt));
        }
        return delays;
    }

    private calculateDelay(attempt: number): number {
        let delay: number;

        switch (this.config.strategy) {
            case RetryStrategy.FIXED:
                delay = this.config.baseDelayMs;
                break;

            case RetryStrategy.EXPONENTIAL:
                delay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1);
                break;

            case RetryStrategy.LINEAR:
                delay = this.config.baseDelayMs * attempt;
                break;

            default:
                delay = this.config.baseDelayMs;
        }

        // 应用最大延迟限制
        return Math.min(delay, this.config.maxDelayMs);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 常用的重试配置预设
 */
export const RetryPresets = {
    /** 快速重试：适用于网络抖动 */
    FAST: {
        maxRetries: 3,
        baseDelayMs: 500,
        strategy: RetryStrategy.EXPONENTIAL,
        maxDelayMs: 5000
    } as RetryConfig,

    /** 标准重试：适用于一般的服务调用 */
    STANDARD: {
        maxRetries: 5,
        baseDelayMs: 1000,
        strategy: RetryStrategy.EXPONENTIAL,
        maxDelayMs: 30000
    } as RetryConfig,

    /** 慢速重试：适用于重要但不紧急的操作 */
    SLOW: {
        maxRetries: 10,
        baseDelayMs: 2000,
        strategy: RetryStrategy.EXPONENTIAL,
        maxDelayMs: 60000
    } as RetryConfig,

    /** 数据库重试：适用于数据库操作 */
    DATABASE: {
        maxRetries: 3,
        baseDelayMs: 100,
        strategy: RetryStrategy.EXPONENTIAL,
        maxDelayMs: 2000,
        shouldRetry: (error: Error) => {
            // 只对特定的数据库错误进行重试
            const retryableErrors = [
                'connection timeout',
                'connection reset',
                'deadlock',
                'lock timeout'
            ];
            return retryableErrors.some(msg => 
                error.message.toLowerCase().includes(msg)
            );
        }
    } as RetryConfig
};
