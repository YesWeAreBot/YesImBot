/**
 * 熔断器实现
 * 
 * 熔断器是一种用于防止级联故障的设计模式。当服务出现故障时，
 * 熔断器会"打开"，阻止进一步的请求，从而保护系统免受过载。
 * 
 * ## 状态说明
 * 
 * ### CLOSED（关闭状态）
 * - 正常状态，所有请求都会被执行
 * - 记录失败次数，当失败次数达到阈值时转为 OPEN 状态
 * 
 * ### OPEN（打开状态）
 * - 熔断状态，所有请求都会被直接拒绝
 * - 在指定时间后转为 HALF_OPEN 状态
 * 
 * ### HALF_OPEN（半开状态）
 * - 试探状态，允许少量请求通过
 * - 如果请求成功，转为 CLOSED 状态
 * - 如果请求失败，转回 OPEN 状态
 * 
 * ## 使用示例
 * 
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,    // 失败阈值
 *   resetTimeoutMs: 60000,  // 重置超时时间
 *   monitoringPeriodMs: 30000 // 监控周期
 * });
 * 
 * // 执行受保护的操作
 * const result = await breaker.execute(async () => {
 *   return await someRiskyOperation();
 * });
 * 
 * if (result.success) {
 *   console.log('操作成功:', result.data);
 * } else {
 *   console.log('操作失败:', result.error);
 * }
 * ```
 */

export enum CircuitBreakerState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
    /** 失败阈值：连续失败多少次后打开熔断器 */
    failureThreshold: number;
    /** 重置超时时间：熔断器打开后多久尝试半开状态（毫秒） */
    resetTimeoutMs: number;
    /** 监控周期：统计失败次数的时间窗口（毫秒） */
    monitoringPeriodMs: number;
    /** 半开状态下的最大尝试次数 */
    halfOpenMaxAttempts?: number;
}

export interface CircuitBreakerResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    state: CircuitBreakerState;
}

interface FailureRecord {
    timestamp: number;
    error: string;
}

export class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failures: FailureRecord[] = [];
    private lastFailureTime: number = 0;
    private halfOpenAttempts: number = 0;
    private readonly config: Required<CircuitBreakerConfig>;

    constructor(config: CircuitBreakerConfig) {
        this.config = {
            halfOpenMaxAttempts: 3,
            ...config
        };
    }

    /**
     * 执行受保护的操作
     */
    async execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
        // 检查当前状态
        this.updateState();

        // 如果熔断器打开，直接拒绝
        if (this.state === CircuitBreakerState.OPEN) {
            return {
                success: false,
                error: '熔断器已打开，请求被拒绝',
                state: this.state
            };
        }

        // 如果是半开状态，检查尝试次数
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
                return {
                    success: false,
                    error: '半开状态尝试次数已达上限',
                    state: this.state
                };
            }
            this.halfOpenAttempts++;
        }

        try {
            const result = await operation();
            this.onSuccess();
            return {
                success: true,
                data: result,
                state: this.state
            };
        } catch (error) {
            this.onFailure(error instanceof Error ? error.message : String(error));
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                state: this.state
            };
        }
    }

    /**
     * 获取当前状态
     */
    getState(): CircuitBreakerState {
        this.updateState();
        return this.state;
    }

    /**
     * 获取统计信息
     */
    getStats() {
        this.cleanupOldFailures();
        return {
            state: this.state,
            failureCount: this.failures.length,
            lastFailureTime: this.lastFailureTime,
            halfOpenAttempts: this.halfOpenAttempts
        };
    }

    /**
     * 手动重置熔断器
     */
    reset(): void {
        this.state = CircuitBreakerState.CLOSED;
        this.failures = [];
        this.lastFailureTime = 0;
        this.halfOpenAttempts = 0;
    }

    private onSuccess(): void {
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            // 半开状态下成功，转为关闭状态
            this.state = CircuitBreakerState.CLOSED;
            this.halfOpenAttempts = 0;
        }
        // 成功时清理旧的失败记录
        this.cleanupOldFailures();
    }

    private onFailure(error: string): void {
        const now = Date.now();
        this.failures.push({ timestamp: now, error });
        this.lastFailureTime = now;

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            // 半开状态下失败，转回打开状态
            this.state = CircuitBreakerState.OPEN;
            this.halfOpenAttempts = 0;
        } else if (this.state === CircuitBreakerState.CLOSED) {
            // 检查是否需要打开熔断器
            this.cleanupOldFailures();
            if (this.failures.length >= this.config.failureThreshold) {
                this.state = CircuitBreakerState.OPEN;
            }
        }
    }

    private updateState(): void {
        if (this.state === CircuitBreakerState.OPEN) {
            const now = Date.now();
            if (now - this.lastFailureTime >= this.config.resetTimeoutMs) {
                this.state = CircuitBreakerState.HALF_OPEN;
                this.halfOpenAttempts = 0;
            }
        }
        this.cleanupOldFailures();
    }

    private cleanupOldFailures(): void {
        const now = Date.now();
        const cutoff = now - this.config.monitoringPeriodMs;
        this.failures = this.failures.filter(failure => failure.timestamp > cutoff);
    }
}
