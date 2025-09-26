// 模型切换器相关类型定义和枚举

export enum ChatModelType {
    Vision = "vision", // 多模态模型（支持图片）
    NonVision = "non_vision", // 普通文本模型
    All = "all", // 所有模型
}

export enum ModelAbility {
    Vision = "视觉",
    WebSearch = "网络搜索",
    Reasoning = "推理",
    FunctionCalling = "函数调用",
}

export enum ModelType {
    Chat = "Chat",
    Image = "Image",
    Embedding = "Embedding",
}

export enum SwitchStrategy {
    RoundRobin = "round_robin", // 轮询：依次使用每个模型
    Failover = "failover", // 故障转移：优先使用主模型
    Random = "random", // 随机：随机选择模型
    WeightedRandom = "weighted_random", // 加权随机：根据权重选择
}

export enum ModelErrorType {
    NetworkError = "network_error", // 网络错误
    RateLimitError = "rate_limit_error", // 限流错误
    AuthenticationError = "auth_error", // 认证错误
    ContentFilterError = "content_filter", // 内容过滤错误
    InvalidRequestError = "invalid_request", // 请求参数错误
    ServerError = "server_error", // 服务器内部错误
    TimeoutError = "timeout_error", // 超时错误
    QuotaExceededError = "quota_exceeded", // 配额超限错误
    UnknownError = "unknown_error", // 未知错误
}

export class ModelError extends Error {
    constructor(
        public readonly type: ModelErrorType,
        message: string,
        public readonly originalError?: Error,
        public readonly retryable: boolean = true
    ) {
        super(message);
        this.name = "ModelError";
    }

    canRetry(): boolean {
        return this.retryable;
    }

    static classify(error: Error): ModelError {
        const message = error.message.toLowerCase();

        // 网络相关错误
        if (message.includes("network") || message.includes("connection") || message.includes("timeout")) {
            return new ModelError(ModelErrorType.NetworkError, error.message, error, true);
        }

        // 限流错误
        if (message.includes("rate limit") || message.includes("too many requests") || error.message.includes("429")) {
            return new ModelError(ModelErrorType.RateLimitError, error.message, error, true);
        }

        // 认证错误
        if (message.includes("auth") || message.includes("unauthorized") || message.includes("401")) {
            return new ModelError(ModelErrorType.AuthenticationError, error.message, error, false);
        }

        // 内容过滤
        if (message.includes("content policy") || message.includes("filtered")) {
            return new ModelError(ModelErrorType.ContentFilterError, error.message, error, false);
        }

        // 请求参数错误
        if (message.includes("invalid") || message.includes("bad request") || message.includes("400")) {
            return new ModelError(ModelErrorType.InvalidRequestError, error.message, error, false);
        }

        // 配额超限
        if (message.includes("quota") || message.includes("exceeded") || message.includes("limit")) {
            return new ModelError(ModelErrorType.QuotaExceededError, error.message, error, false);
        }

        // 服务器错误
        if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
            return new ModelError(ModelErrorType.ServerError, error.message, error, true);
        }

        // 超时错误
        if (message.includes("timeout")) {
            return new ModelError(ModelErrorType.TimeoutError, error.message, error, true);
        }

        // 默认未知错误，可重试
        return new ModelError(ModelErrorType.UnknownError, error.message, error, true);
    }
}

export interface ModelHealthInfo {
    /** 模型是否可用 */
    isHealthy: boolean;
    /** 连续失败次数 */
    failureCount: number;
    /** 最后一次失败时间 */
    lastFailureTime?: number;
    /** 最后一次成功时间 */
    lastSuccessTime?: number;
    /** 平均响应延迟(ms) */
    averageLatency: number;
    /** 总请求数 */
    totalRequests: number;
    /** 成功请求数 */
    successRequests: number;
    /** 失败请求数 */
    failureRequests: number;
    /** 成功率 */
    successRate: number;
    /** 模型权重 */
    weight: number;
    /** 是否在熔断状态 */
    isCircuitBroken: boolean;
    /** 熔断恢复时间 */
    circuitBreakerResetTime?: number;
}
