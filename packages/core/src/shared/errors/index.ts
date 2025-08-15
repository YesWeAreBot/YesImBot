import { Logger, Schema } from "koishi";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";

import { truncate } from "@/shared/utils";
import { ErrorDefinitions } from "./definitions";

// --- 错误上报模块 ---

export interface ErrorReporterConfig {
    enabled: boolean; // 是否启用上报
    pasteServiceUrl?: string; // 可配置的上-报链接
    includeSystemInfo?: boolean; // 是否包含系统信息
}

export const ErrorReporterConfigSchema = Schema.object({
    enabled: Schema.boolean().default(true).description("是否启用错误上报"),
    pasteServiceUrl: Schema.string().role("link").default("https://dump.yesimbot.chat/").description("错误上报服务的 URL"),
    includeSystemInfo: Schema.boolean().default(true).description("是否包含系统信息"),
});

export interface ReportContext {
    errorId: string;
    error: Error;
    additionalInfo?: Record<string, any>;
}

/**
 * 负责格式化错误详情并将其上报到外部服务
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
            this.logger.warn("已启用上报但未配置 pasteServiceUrl，上报功能将不会生效。");
        }
    }

    /**
     * 格式化并上报错误
     * @param context 包含错误和附加上下文的对象
     */
    public async report(context: ReportContext): Promise<string> {
        if (!this.config.enabled || !this.config.pasteServiceUrl) {
            return null;
        }

        try {
            const dump = this.formatErrorDump(context);
            const url = await this.uploadToPaste(dump);
            if (url) {
                this.logger.info(`此错误已上报，可通过 ${url} 查看详细信息`);
            }
            return url;
        } catch (uploadError) {
            this.logger.error(`上报失败: ${(uploadError as Error).message}`);
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
                this.logger.error(`上传服务返回错误: ${response.status} - ${response.statusText}`);
                return null;
            }

            const data = await response.json();
            return data?.url || null;
        } catch (error) {
            this.logger.error(`连接上报服务失败: ${(error as Error).message}`);
            return null;
        }
    }

    private formatErrorDump(context: ReportContext): string {
        const { error, errorId } = context;
        const appError = error instanceof AppError ? error : new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { cause: error });

        const { code, suggestion, context: errorContext, cause, stack } = appError;
        const packageJson = require(resolve(__dirname, "../../../package.json"));
        const dumpSections: string[] = [];

        // --- 摘要 ---
        dumpSections.push(
            `# 智能体错误报告\n`,
            `**ID:** \`${errorId}\`\n`,
            `**时间 (UTC):** \`${new Date().toISOString()}\`\n`,
            `**插件版本:** \`${packageJson.version || "N/A"}\`\n`,
            `**错误码:** \`${code}\`\n`,
            `---`
        );

        // --- 错误与建议 ---
        dumpSections.push(`## 🔴 错误摘要\n`, `**${appError.message}**\n`, `## 💡 用户建议\n`, `*${suggestion}*\n`, `---`);

        // --- 技术细节 ---
        if (errorContext && Object.keys(errorContext).length > 0) {
            dumpSections.push(`## 🛠️ 技术上下文\n`);
            for (const [key, value] of Object.entries(errorContext)) {
                // 特殊处理长文本和对象
                if (key === "rawResponse" && typeof value === "string") {
                    dumpSections.push(`### 原始 LLM 响应:\n`, "```json\n" + value + "\n```");
                } else if (key === "schedulingStack" && typeof value === "string") {
                    dumpSections.push(`### 调度堆栈:\n`, "```\n" + value + "\n```");
                } else {
                    dumpSections.push(`**${key}:**\n`, "```json\n" + JSON.stringify(value, null, 2) + "\n```");
                }
            }
            dumpSections.push(`---`);
        }

        // --- 堆栈追踪 ---
        if (stack) {
            dumpSections.push(`## 📄 主堆栈追踪:\n`, "```\n" + stack + "\n```");
        }
        if (cause) {
            const causeError = cause as Error;
            dumpSections.push(
                `## 🔗 根本原因 (Cause):\n`,
                `**Type:** \`${causeError.name}\`\n`,
                `**Message:** \`${causeError.message}\`\n`,
                "```\n" + (causeError.stack || "No stack available.") + "\n```"
            );
            if (causeError instanceof AggregateError) {
                dumpSections.push(`### 🌿 聚合错误包含的内部错误:\n`);
                causeError.errors.forEach((e, index) => {
                    dumpSections.push(`#### 内部错误 ${index + 1}:\n`, "```\n" + e.stack + "\n```");
                });
                dumpSections.push(`---`);
            }
        }

        return dumpSections.join("\n");
    }
}

// --- 统一错误处理器 ---

let globalErrorReporter: ErrorReporter | null = null;

export function initializeErrorReporter(config: ErrorReporterConfig, logger: Logger) {
    globalErrorReporter = new ErrorReporter(config, logger);
}

type ErrorDomains = keyof typeof ErrorDefinitions;

export type ErrorDefinitionValue = {
    [K in ErrorDomains]: (typeof ErrorDefinitions)[K][keyof (typeof ErrorDefinitions)[K]];
}[ErrorDomains];

export class AppError extends Error {
    public readonly code: string;
    public readonly suggestion: string;
    public readonly errorId: string;

    public context?: Record<string, any>;

    constructor(
        definition: ErrorDefinitionValue,
        options?: {
            context?: Record<string, any>;
            cause?: Error;
            args?: any[];
        }
    ) {
        let message: string;
        let suggestion: string;

        if (typeof definition.message === "function") {
            message = definition.message.apply(null, options?.args || []);
        } else {
            message = definition.message;
        }

        if (typeof definition.suggestion === "function") {
            suggestion = definition.suggestion.apply(null, options?.args || []);
        } else {
            suggestion = definition.suggestion;
        }

        super(message, { cause: options?.cause });

        this.name = "AppError";
        this.code = definition.code;
        this.suggestion = suggestion;
        this.context = options?.context;
        this.errorId = uuidv4();

        Object.setPrototypeOf(this, AppError.prototype);
    }

    addContext(context: Record<string, any>) {
        this.context = { ...this.context, ...context };
    }
}

/**
 * 统一错误处理函数
 * 实现了分层日志记录和可选的错误自动上报功能
 * @param logger - Koishi 的 Logger 实例，用于记录日志
 * @param error - 捕获到的未知类型的错误
 * @param contextDescription - 描述错误发生时的操作或环节，例如 "处理聊天请求"
 * @returns 返回生成的唯一错误 ID
 */
export function handleError(logger: Logger, error: unknown, contextDescription: string): string {
    let appError: AppError;

    // 步骤 1: 确保错误是 AppError 类型
    // 如果捕获到的不是 AppError，则将其包装成一个通用的系统未知错误，以便统一处理
    if (error instanceof AppError) {
        appError = error;
    } else {
        // 保留原始错误信息作为排查线索
        const cause = error instanceof Error ? error : undefined;
        appError = new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, {
            cause,
            context: { capturedValue: error },
        });
    }

    const { errorId, message, suggestion, context, stack } = appError;

    // 步骤 2: 分层记录日志
    // 第一层：面向用户/管理员的清晰错误报告 (ERROR 级别)
    logger.error(`🛑 [错误报告]`);
    logger.error(`   - 环节: ${contextDescription}`);
    logger.error(`   - 详情: ${message}`);
    logger.error(`   - 建议: ${suggestion}`);

    // 第二层：面向开发者的详细调试信息 (WARN / DEBUG 级别，避免日志泛滥)
    const devContext = { ...context };
    // 对可能很长的原始响应进行截断，防止刷屏
    if (devContext.rawResponse) {
        devContext.rawResponse = truncate(devContext.rawResponse as string, 200) + "... (完整响应见上报信息)";
    }
    if (Object.keys(devContext).length > 0) {
        logger.warn(`   - 调试上下文: ${JSON.stringify(devContext)}`);
    }
    // 堆栈信息使用 DEBUG 级别，仅在需要时通过调整日志等级查看
    logger.debug(`   - 堆栈追踪:\n${stack}`);

    // 步骤 3: 触发全局错误上报 (例如上报到 Sentry 等监控服务)
    if (globalErrorReporter) {
        globalErrorReporter.report({
            errorId,
            error: appError,
        });
    } else {
        logger.warn(`   - 追踪: 此错误未上报，如需查看更多信息，请打开 DEBUG 日志查看堆栈信息`);
    }

    return errorId;
}

export * from "./definitions";
