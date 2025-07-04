/**
 * 应用程序的统一错误码。
 * 使用常量对象而不是枚举，以获得更好的灵活性和 Tree-shaking 效果。
 * 格式: DOMAIN.CATEGORY_OR_DETAIL
 */
export const ErrorCodes = {
    // 通用系统错误
    SYSTEM: {
        UNKNOWN: "SYSTEM.UNKNOWN",
        DATABASE_ERROR: "SYSTEM.DATABASE_ERROR",
        NETWORK_ERROR: "SYSTEM.NETWORK_ERROR",
        SERVICE_UNAVAILABLE: "SYSTEM.SERVICE_UNAVAILABLE",
    },
    // 配置错误
    CONFIG: {
        MISSING: "CONFIG.MISSING",
        INVALID: "CONFIG.INVALID",
    },
    // 验证错误
    VALIDATION: {
        INVALID_INPUT: "VALIDATION.INVALID_INPUT",
        IS_NULL_OR_UNDEFINED: "VALIDATION.IS_NULL_OR_UNDEFINED",
    },
    // 资源错误
    RESOURCE: {
        NOT_FOUND: "RESOURCE.NOT_FOUND",
        CONFLICT: "RESOURCE.CONFLICT",
        EXHAUSTED: "RESOURCE.EXHAUSTED",
        STORAGE_FAILURE: "RESOURCE.STORAGE_FAILURE",
        LIMIT_EXCEEDED: "RESOURCE.LIMIT_EXCEEDED",
    },
    // 权限与认证
    AUTH: {
        PERMISSION_DENIED: "AUTH.PERMISSION_DENIED",
        AUTHENTICATION_FAILED: "AUTH.AUTHENTICATION_FAILED",
    },
    // LLM 相关错误
    LLM: {
        REQUEST_FAILED: "LLM.REQUEST_FAILED",
        TIMEOUT: "LLM.TIMEOUT",
        ADAPTER_ERROR: "LLM.ADAPTER_ERROR",
        RETRY_EXHAUSTED: "LLM.RETRY_EXHAUSTED",
        OUTPUT_PARSING_FAILED: "LLM.OUTPUT_PARSING_FAILED",
        MODEL_NOT_FOUND: "LLM.MODEL_NOT_FOUND",
    },
    NETWORK:{
        DOWNLOAD_FAILED: "NETWORK.DOWNLOAD_FAILED",
    },
    // 记忆相关错误
    MEMORY: {
        PROVIDER_ERROR: "MEMORY.PROVIDER_ERROR",
    },
    // 工具相关错误
    TOOL: {
        NOT_FOUND: "TOOL.NOT_FOUND",
        EXECUTION_ERROR: "TOOL.EXECUTION_ERROR",
        TIMEOUT: "TOOL.TIMEOUT",
    },
} as const;

// 从 ErrorCodes 对象中提取所有可能的值作为类型
type ObjectValues<T> = T[keyof T];
type NestedObjectValues<T> = { [K in keyof T]: ObjectValues<T[K]> }[keyof T];
export type ErrorCode = NestedObjectValues<typeof ErrorCodes>;

/**
 * 统一的应用程序错误类。
 * 扩展自原生的 Error，并添加了 code 和 context 属性。
 */
export class AppError extends Error {
    public readonly code: ErrorCode;
    public readonly context?: Record<string, any>;

    constructor(
        message: string,
        options: {
            code: ErrorCode;
            context?: Record<string, any>;
            cause?: Error;
        }
    ) {
        super(message, { cause: options.cause });
        this.name = "AppError";
        this.code = options.code;
        this.context = options.context;

        // 恢复原型链
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

// --- 实用断言函数 ---

/**
 * 断言条件为真，否则抛出 AppError。
 * @param condition - 要检查的条件。
 * @param message - 错误消息。
 * @param code - 错误码，默认为输入验证错误。
 */
export function assert(
    condition: unknown,
    message: string,
    code: ErrorCode = ErrorCodes.VALIDATION.INVALID_INPUT
): asserts condition {
    if (!condition) {
        throw new AppError(message, { code });
    }
}

/**
 * 断言值不为 null 或 undefined。
 * @param value - 要检查的值。
 * @param name - 值的名称，用于生成错误消息。
 */
export function assertNotNull<T>(
    value: T | null | undefined,
    name: string
): asserts value is T {
    if (value === null || value === undefined) {
        throw new AppError(`${name} 不能为空`, {
            code: ErrorCodes.VALIDATION.IS_NULL_OR_UNDEFINED,
            context: { field: name },
        });
    }
}

/**
 * 断言资源存在。
 * @param value - 要检查的资源。
 * @param resourceType - 资源类型，如 'User', 'Document'。
 * @param resourceId - （可选）资源的标识符。
 */
export function assertExists<T>(
    value: T | null | undefined,
    resourceType: string,
    resourceId?: string
): asserts value is T {
    if (value === null || value === undefined) {
        throw new AppError(`${resourceType} 不存在`, {
            code: ErrorCodes.RESOURCE.NOT_FOUND,
            context: { resourceType, resourceId },
        });
    }
}