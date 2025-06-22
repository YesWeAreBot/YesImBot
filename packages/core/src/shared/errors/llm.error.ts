import { BaseError, ErrorContext, ErrorSeverity, ErrorType } from "./base.error";

/**
 * LLM请求错误
 */
export class LLMRequestError extends BaseError {
    public readonly adapterName?: string;
    public readonly retryCount: number;
    public readonly isRetryable: boolean;

    constructor(
        message: string,
        adapterName?: string,
        retryCount: number = 0,
        isRetryable: boolean = true,
        context: ErrorContext = {},
        cause?: Error
    ) {
        super(
            message,
            `LLM_REQUEST_ERROR_${adapterName?.toUpperCase() || 'UNKNOWN'}`,
            ErrorType.LLM_REQUEST_ERROR,
            ErrorSeverity.MEDIUM,
            { ...context, adapterName, retryCount, isRetryable },
            cause
        );
        this.adapterName = adapterName;
        this.retryCount = retryCount;
        this.isRetryable = isRetryable;
    }

    toUserMessage(): string {
        if (this.adapterName) {
            return `AI模型 ${this.adapterName} 请求失败，正在重试...`;
        }
        return "AI模型请求失败，正在重试...";
    }
}

/**
 * LLM超时错误
 */
export class LLMTimeoutError extends BaseError {
    public readonly timeoutMs: number;
    public readonly adapterName?: string;

    constructor(
        message: string,
        timeoutMs: number,
        adapterName?: string,
        context: ErrorContext = {}
    ) {
        super(
            message,
            `LLM_TIMEOUT_ERROR_${adapterName?.toUpperCase() || 'UNKNOWN'}`,
            ErrorType.LLM_TIMEOUT_ERROR,
            ErrorSeverity.MEDIUM,
            { ...context, timeoutMs, adapterName }
        );
        this.timeoutMs = timeoutMs;
        this.adapterName = adapterName;
    }

    toUserMessage(): string {
        return `AI模型响应超时（${this.timeoutMs}ms），正在重试...`;
    }
}

/**
 * LLM适配器错误
 */
export class LLMAdapterError extends BaseError {
    public readonly adapterName: string;
    public readonly availableAdapters: number;

    constructor(
        message: string,
        adapterName: string,
        availableAdapters: number = 0,
        context: ErrorContext = {},
        cause?: Error
    ) {
        super(
            message,
            `LLM_ADAPTER_ERROR_${adapterName.toUpperCase()}`,
            ErrorType.LLM_ADAPTER_ERROR,
            ErrorSeverity.HIGH,
            { ...context, adapterName, availableAdapters },
            cause
        );
        this.adapterName = adapterName;
        this.availableAdapters = availableAdapters;
    }

    toUserMessage(): string {
        return `AI模型适配器 ${this.adapterName} 不可用，正在切换到其他适配器...`;
    }
}

/**
 * LLM重试耗尽错误
 */
export class LLMRetryExhaustedError extends BaseError {
    public readonly totalAttempts: number;
    public readonly failedAdapters: string[];
    public readonly lastError?: Error;

    constructor(
        message: string,
        totalAttempts: number,
        failedAdapters: string[] = [],
        lastError?: Error,
        context: ErrorContext = {}
    ) {
        super(
            message,
            "LLM_RETRY_EXHAUSTED",
            ErrorType.LLM_RETRY_EXHAUSTED,
            ErrorSeverity.HIGH,
            { ...context, totalAttempts, failedAdapters, lastError: lastError?.message },
            lastError
        );
        this.totalAttempts = totalAttempts;
        this.failedAdapters = failedAdapters;
        this.lastError = lastError;
    }

    toUserMessage(): string {
        return `AI模型服务暂时不可用，已尝试 ${this.totalAttempts} 次。请稍后重试。`;
    }
}