import { Logger, Schema } from "koishi";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";

import { truncate } from "@/shared/utils";

// --- 错误上报模块 ---

export interface ErrorReporterConfig {
    enabled: boolean; // 是否启用上报
    pasteServiceUrl?: string; // 可配置的上-报链接
    includeSystemInfo?: boolean; // 是否包含系统信息
}

export const ErrorReporterConfigSchema = Schema.object({
    enabled: Schema.boolean().default(false).description("是否启用错误上报"),
    pasteServiceUrl: Schema.string()
        .role("link")
        .default("https://dump.yesimbot.chat/")
        .description("错误上报服务的 URL"),
    includeSystemInfo: Schema.boolean().default(true).description("是否包含系统信息"),
});

export interface ReportContext {
    errorId: string;
    error: Error;
    additionalInfo?: Record<string, any>;
}

/**
 * 负责格式化错误详情并将其上报到外部服务。
 * 设计灵感来源于您提供的 ErrorHandlingMiddleware。
 */
export class ErrorReporter {
    private readonly config: ErrorReporterConfig;
    private readonly logger: Logger;

    constructor(config: ErrorReporterConfig, logger: Logger) {
        this.config = {
            enabled: false,
            includeSystemInfo: true,
            ...config,
        };
        this.logger = logger;

        if (this.config.enabled && !this.config.pasteServiceUrl) {
            this.logger.warn("[ErrorReporter] 已启用上报但未配置 pasteServiceUrl，上报功能将不会生效。");
        }
    }

    /**
     * 格式化并上报错误。
     * @param context 包含错误和附加上下文的对象
     */
    public async report(context: ReportContext): Promise<void> {
        if (!this.config.enabled || !this.config.pasteServiceUrl) {
            return;
        }

        try {
            const dump = this.formatErrorDump(context);
            const url = await this.uploadToPaste(dump);
            if (url) {
                this.logger.info(`[错误报告] [ID: ${context.errorId}] 成功上传到: ${url}`);
            }
        } catch (uploadError) {
            this.logger.error(`[错误报告] [ID: ${context.errorId}] 上报失败: ${(uploadError as Error).message}`);
        }
    }

    private async uploadToPaste(content: string): Promise<string | null> {
        try {
            // 在 Node.js 环境中，通常使用 FormData 或直接构建 multipart/form-data
            const formData = new FormData();
            formData.append("c", content);

            const response = await fetch(this.config.pasteServiceUrl!, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                this.logger.error(`[错误报告] 上传服务返回错误: ${response.status} - ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            return data?.url || null;
        } catch (error) {
            this.logger.error(`[错误报告] 连接上报服务失败: ${(error as Error).message}`);
            return null;
        }
    }

    private formatErrorDump(context: ReportContext): string {
        const { error, errorId, additionalInfo } = context;
        const dumpSections: string[] = [];
        const packageJson = require(resolve(__dirname, "../../../package.json"));

        dumpSections.push(
            `# 智能体错误报告\n`,
            `**错误 ID:** \`${errorId}\`\n`,
            `**时间戳 (UTC):** \`${new Date().toISOString()}\`\n`,
            `**插件版本:** \`${packageJson.version || "N/A"}\`\n`,
            `---`
        );

        dumpSections.push(`## 🔴 错误详情\n`, `**类型:** \`${error.name}\`\n`, `**消息:** \`${error.message}\`\n`);
        if (error.stack) {
            dumpSections.push(`### 堆栈追踪:\n`, "```\n" + error.stack + "\n```");
        }
        if ((error as AppError).cause) {
            const cause = (error as AppError).cause as Error;
            dumpSections.push(
                `### 根本原因 (Cause):\n`,
                `**类型:** \`${cause.name}\`\n`,
                `**消息:** \`${cause.message}\`\n`,
                "```\n" + cause.stack + "\n```"
            );
        }

        // 关键：将附加信息格式化，特别是 LLM 的原始响应
        if (additionalInfo && Object.keys(additionalInfo).length > 0) {
            dumpSections.push(`\n---\n`, `## ➕ 附加上下文\n`);
            for (const [key, value] of Object.entries(additionalInfo)) {
                // 对 rawResponse 进行特殊格式化
                if (key === "rawResponse" && typeof value === "string") {
                    dumpSections.push(`### 原始 LLM 响应 (Raw LLM Response):\n`, "```json\n" + value + "\n```");
                } else {
                    dumpSections.push(`**${key}:**\n`, "```json\n" + JSON.stringify(value, null, 2) + "\n```");
                }
            }
        }

        if (this.config.includeSystemInfo) {
            dumpSections.push(
                `\n---\n`,
                `## ⚙️ 系统信息\n`,
                `**Node.js:** \`${process.version}\` | **平台:** \`${process.platform}\` | **架构:** \`${process.arch}\``
            );
        }

        return dumpSections.join("\n");
    }
}

// --- 统一错误处理器 ---

// 在服务启动时创建单例
let globalErrorReporter: ErrorReporter | null = null;

export function initializeErrorReporter(config: ErrorReporterConfig, logger: Logger) {
    globalErrorReporter = new ErrorReporter(config, logger);
}

/**
 * 应用程序的统一错误码
 * 使用常量对象而不是枚举，以获得更好的灵活性和 Tree-shaking 效果
 * 格式: DOMAIN.CATEGORY_OR_DETAIL
 */
export const ErrorCodes = {
    // 服务相关错误
    SERVICE: {
        UNAVAILABLE: "SERVICE.UNAVAILABLE",
        INITIALIZATION_FAILURE: "SERVICE.INITIALIZATION_FAILURE",
        START_FAILURE: "SERVICE.START_FAILURE",
        STOP_FAILURE: "SERVICE.STOP_FAILURE",
    },
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
    NETWORK: {
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
    // 操作相关错误
    OPERATION: {
        LOCK_TIMEOUT: "OPERATION.LOCK_TIMEOUT",
        CIRCUIT_BREAKER_OPEN: "OPERATION.CIRCUIT_BREAKER_OPEN",
        SERVICE_SHUTTING_DOWN: "OPERATION.SERVICE_SHUTTING_DOWN",
        RETRY_EXHAUSTED: "OPERATION.RETRY_EXHAUSTED",
    },
} as const;

// 从 ErrorCodes 对象中提取所有可能的值作为类型
type ObjectValues<T> = T[keyof T];
type NestedObjectValues<T> = { [K in keyof T]: ObjectValues<T[K]> }[keyof T];
export type ErrorCode = NestedObjectValues<typeof ErrorCodes>;

/**
 * 统一的应用程序错误类
 * 扩展自原生的 Error，并添加了 code、context 和唯一的 errorId
 */
export class AppError extends Error {
    public readonly code: ErrorCode;
    public readonly context?: Record<string, any>;
    public readonly errorId: string; // 新增：可追踪的错误ID

    constructor(
        message: string,
        options: {
            code: ErrorCode;
            context?: Record<string, any>;
            cause?: Error;
        }
    ) {
        super(message, { cause: options.cause });
        this.name = "AppError"; // 明确错误名称
        this.code = options.code;
        this.context = options.context;
        this.errorId = uuidv4(); // 实例化时即生成唯一ID

        // 恢复原型链，确保 `instanceof AppError` 能正常工作
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

// --- 实用断言函数 (保持不变, 设计得很好) ---

export function assert(
    condition: unknown,
    message: string,
    code: ErrorCode = ErrorCodes.VALIDATION.INVALID_INPUT
): asserts condition {
    if (!condition) {
        throw new AppError(message, { code });
    }
}

export function assertNotNull<T>(value: T | null | undefined, name: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new AppError(`${name} 不能为空`, {
            code: ErrorCodes.VALIDATION.IS_NULL_OR_UNDEFINED,
            context: { field: name },
        });
    }
}

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

// --- 错误处理与日志记录函数 ---

/**
 * 统一错误处理函数。
 * 现在会自动触发上报（如果已配置）。
 */
export function handleError(logger: Logger, error: unknown, contextDescription: string): string {
    let appError: AppError;

    if (error instanceof AppError) {
        appError = error;
    } else if (error instanceof Error) {
        // 将标准 Error 包装成 AppError，以便统一处理
        appError = new AppError(error.message, {
            code: ErrorCodes.SYSTEM.UNKNOWN, // 标记为未知系统错误
            cause: error,
        });
    } else {
        // 将非 Error 对象包装成 AppError
        const message = "捕获到非标准错误对象";
        appError = new AppError(message, {
            code: ErrorCodes.SYSTEM.UNKNOWN,
            context: { capturedValue: error },
        });
    }

    const { errorId, code, message, context, cause, stack, name } = appError;

    // 记录美观的日志
    logger.error(`[错误] [ID: ${errorId}] 在 ${contextDescription} 期间发生错误。`);
    logger.error(`  - 类型: ${name} | 错误码: ${code}`);
    logger.error(`  - 信息: ${message}`);
    if (context) {
        // 特别注意：不要在日志中打印可能非常长的原始响应
        const logContext = { ...context };
        if ("rawResponse" in logContext) {
            logContext.rawResponse = truncate(logContext.rawResponse as string, 200) + "... (完整内容见上报)";
        }
        logger.error(`  - 上下文: ${JSON.stringify(logContext)}`);
    }
    if (cause) {
        logger.error(`  - 根本原因: ${(cause as Error).name} - ${(cause as Error).message}`);
    }
    logger.debug(`  - 堆栈追踪:\n${stack}`);

    // 触发上报
    if (globalErrorReporter) {
        globalErrorReporter.report({
            errorId,
            error: appError,
            // 将 AppError 的 context 作为上报的 additionalInfo
            additionalInfo: context,
        });
    }

    return errorId;
}
