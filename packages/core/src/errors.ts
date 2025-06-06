// packages/core/src/errors/index.ts

/**
 * 错误严重级别
 */
export enum ErrorSeverity {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}

/**
 * 错误类型枚举
 */
export enum ErrorType {
    // 业务错误
    BUSINESS_ERROR = "BUSINESS_ERROR",
    VALIDATION_ERROR = "VALIDATION_ERROR",

    // 系统错误
    SYSTEM_ERROR = "SYSTEM_ERROR",
    NETWORK_ERROR = "NETWORK_ERROR",
    DATABASE_ERROR = "DATABASE_ERROR",

    // 资源错误
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
    RESOURCE_CONFLICT = "RESOURCE_CONFLICT",
    RESOURCE_EXHAUSTED = "RESOURCE_EXHAUSTED",

    // 权限错误
    PERMISSION_DENIED = "PERMISSION_DENIED",
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",

    // 配置错误
    CONFIG_ERROR = "CONFIG_ERROR",
    CONFIG_VALIDATION_ERROR = "CONFIG_VALIDATION_ERROR"
}

/**
 * 错误上下文接口
 */
export interface ErrorContext {
    [key: string]: any;
    timestamp?: Date;
    userId?: string;
    channelId?: string;
    messageId?: string;
    operation?: string;
    stackTrace?: string;
}

/**
 * 基础错误类
 */
export abstract class BaseError extends Error {
    public readonly code: string;
    public readonly type: ErrorType;
    public readonly severity: ErrorSeverity;
    public readonly context: ErrorContext;
    public readonly timestamp: Date;
    public readonly id: string;

    constructor(
        message: string,
        code: string,
        type: ErrorType,
        severity: ErrorSeverity = ErrorSeverity.MEDIUM,
        context: ErrorContext = {},
        cause?: Error
    ) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.type = type;
        this.severity = severity;
        this.context = {
            ...context,
            timestamp: new Date(),
            stackTrace: this.stack
        };
        this.timestamp = new Date();
        this.id = this.generateErrorId();

        if (cause) {
            this.cause = cause;
        }

        // 确保原型链正确
        Object.setPrototypeOf(this, new.target.prototype);
    }

    private generateErrorId(): string {
        return `${this.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 转换为日志格式
     */
    public toLogFormat(): string {
        return JSON.stringify({
            id: this.id,
            code: this.code,
            type: this.type,
            severity: this.severity,
            message: this.message,
            context: this.context,
            timestamp: this.timestamp
        }, null, 2);
    }

    /**
     * 转换为用户友好的消息
     */
    public abstract toUserMessage(): string;
}

/**
 * 业务错误
 */
export class BusinessError extends BaseError {
    constructor(
        message: string,
        code: string = "BIZ_ERROR",
        context: ErrorContext = {},
        severity: ErrorSeverity = ErrorSeverity.MEDIUM
    ) {
        super(message, code, ErrorType.BUSINESS_ERROR, severity, context);
    }

    toUserMessage(): string {
        return `操作失败：${this.message}`;
    }
}

/**
 * 验证错误
 */
export class ValidationError extends BaseError {
    public readonly violations: ValidationViolation[];

    constructor(
        message: string,
        violations: ValidationViolation[] = [],
        context: ErrorContext = {}
    ) {
        super(message, "VALIDATION_ERROR", ErrorType.VALIDATION_ERROR, ErrorSeverity.LOW, context);
        this.violations = violations;
    }

    toUserMessage(): string {
        if (this.violations.length > 0) {
            const messages = this.violations.map(v => `${v.field}: ${v.message}`);
            return `验证失败：\n${messages.join('\n')}`;
        }
        return `验证失败：${this.message}`;
    }
}

export interface ValidationViolation {
    field: string;
    value?: any;
    message: string;
    code?: string;
}

/**
 * 系统错误
 */
export class SystemError extends BaseError {
    constructor(
        message: string,
        code: string = "SYS_ERROR",
        context: ErrorContext = {},
        cause?: Error
    ) {
        super(message, code, ErrorType.SYSTEM_ERROR, ErrorSeverity.HIGH, context, cause);
    }

    toUserMessage(): string {
        return "系统内部错误，请稍后重试";
    }
}

/**
 * 资源错误
 */
export class ResourceError extends BaseError {
    public readonly resourceType: string;
    public readonly resourceId?: string;

    constructor(
        message: string,
        resourceType: string,
        resourceId?: string,
        type: ErrorType = ErrorType.RESOURCE_NOT_FOUND,
        context: ErrorContext = {}
    ) {
        super(
            message,
            `${type}_${resourceType.toUpperCase()}`,
            type,
            ErrorSeverity.MEDIUM,
            { ...context, resourceType, resourceId }
        );
        this.resourceType = resourceType;
        this.resourceId = resourceId;
    }

    toUserMessage(): string {
        switch (this.type) {
            case ErrorType.RESOURCE_NOT_FOUND:
                return `未找到指定的${this.resourceType}`;
            case ErrorType.RESOURCE_CONFLICT:
                return `${this.resourceType}已存在或发生冲突`;
            case ErrorType.RESOURCE_EXHAUSTED:
                return `${this.resourceType}资源已耗尽`;
            default:
                return `${this.resourceType}操作失败`;
        }
    }
}

/**
 * 网络错误
 */
export class NetworkError extends BaseError {
    public readonly statusCode?: number;
    public readonly url?: string;

    constructor(
        message: string,
        statusCode?: number,
        url?: string,
        context: ErrorContext = {},
        cause?: Error
    ) {
        super(
            message,
            `NETWORK_ERROR_${statusCode || 'UNKNOWN'}`,
            ErrorType.NETWORK_ERROR,
            ErrorSeverity.MEDIUM,
            { ...context, statusCode, url },
            cause
        );
        this.statusCode = statusCode;
        this.url = url;
    }

    toUserMessage(): string {
        if (this.statusCode) {
            switch (this.statusCode) {
                case 404:
                    return "请求的资源不存在";
                case 403:
                    return "没有权限访问该资源";
                case 500:
                    return "服务器内部错误";
                case 503:
                    return "服务暂时不可用";
                default:
                    return `网络请求失败 (${this.statusCode})`;
            }
        }
        return "网络连接失败，请检查网络设置";
    }
}

/**
 * 配置错误
 */
export class ConfigError extends BaseError {
    public readonly configKey?: string;
    public readonly configValue?: any;

    constructor(
        message: string,
        configKey?: string,
        configValue?: any,
        context: ErrorContext = {}
    ) {
        super(
            message,
            `CONFIG_ERROR_${configKey?.toUpperCase() || 'UNKNOWN'}`,
            ErrorType.CONFIG_ERROR,
            ErrorSeverity.HIGH,
            { ...context, configKey, configValue }
        );
        this.configKey = configKey;
        this.configValue = configValue;
    }

    toUserMessage(): string {
        return `配置错误：${this.configKey || '未知配置项'}`;
    }
}

/**
 * 错误处理器接口
 */
export interface ErrorHandler {
    handle(error: BaseError): Promise<void> | void;
    canHandle(error: BaseError): boolean;
}

/**
 * 全局错误管理器
 */
export class ErrorManager {
    private static instance: ErrorManager;
    private handlers: ErrorHandler[] = [];
    private errorHistory: BaseError[] = [];
    private maxHistorySize = 1000;

    private constructor() {}

    public static getInstance(): ErrorManager {
        if (!ErrorManager.instance) {
            ErrorManager.instance = new ErrorManager();
        }
        return ErrorManager.instance;
    }

    /**
     * 注册错误处理器
     */
    public registerHandler(handler: ErrorHandler): void {
        this.handlers.push(handler);
    }

    /**
     * 处理错误
     */
    public async handleError(error: Error | BaseError): Promise<void> {
        // 转换为 BaseError
        const baseError = this.toBaseError(error);

        // 记录到历史
        this.addToHistory(baseError);

        // 调用所有适用的处理器
        for (const handler of this.handlers) {
            if (handler.canHandle(baseError)) {
                try {
                    await handler.handle(baseError);
                } catch (handlerError) {
                    console.error('Error handler failed:', handlerError);
                }
            }
        }
    }

    /**
     * 转换为 BaseError
     */
    private toBaseError(error: Error | BaseError): BaseError {
        if (error instanceof BaseError) {
            return error;
        }

        // 尝试识别错误类型
        if (error.name === 'ValidationError') {
            return new ValidationError(error.message);
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
            return new NetworkError(error.message, undefined, undefined, {}, error);
        } else {
            return new SystemError(error.message, 'UNKNOWN_ERROR', {}, error);
        }
    }

    /**
     * 添加到历史记录
     */
    private addToHistory(error: BaseError): void {
        this.errorHistory.push(error);
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }
    }

    /**
     * 获取错误历史
     */
    public getErrorHistory(filter?: {
        type?: ErrorType;
        severity?: ErrorSeverity;
        since?: Date;
    }): BaseError[] {
        let history = [...this.errorHistory];

        if (filter) {
            if (filter.type) {
                history = history.filter(e => e.type === filter.type);
            }
            if (filter.severity) {
                history = history.filter(e => e.severity === filter.severity);
            }
            if (filter.since) {
                history = history.filter(e => e.timestamp >= filter.since);
            }
        }

        return history;
    }

    /**
     * 清理错误历史
     */
    public clearHistory(): void {
        this.errorHistory = [];
    }
}

/**
 * 错误包装器
 */
export function wrapError(error: Error, type: ErrorType, context?: ErrorContext): BaseError {
    if (error instanceof BaseError) {
        return error;
    }

    switch (type) {
        case ErrorType.VALIDATION_ERROR:
            return new ValidationError(error.message, [], context);
        case ErrorType.NETWORK_ERROR:
            return new NetworkError(error.message, undefined, undefined, context, error);
        case ErrorType.BUSINESS_ERROR:
            return new BusinessError(error.message, 'WRAPPED_ERROR', context);
        default:
            return new SystemError(error.message, 'WRAPPED_ERROR', context, error);
    }
}

/**
 * 断言工具
 */
export function assert(condition: boolean, message: string, errorType: ErrorType = ErrorType.VALIDATION_ERROR): asserts condition {
    if (!condition) {
        throw new ValidationError(message);
    }
}

/**
 * 断言非空
 */
export function assertNotNull<T>(value: T | null | undefined, name: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new ValidationError(`${name} 不能为空`);
    }
}

/**
 * 断言存在
 */
export function assertExists<T>(value: T | null | undefined, resourceType: string, resourceId?: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new ResourceError(
            `${resourceType} 不存在`,
            resourceType,
            resourceId,
            ErrorType.RESOURCE_NOT_FOUND
        );
    }
}
