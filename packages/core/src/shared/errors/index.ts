import { Logger, Schema } from "koishi";
import { v4 as uuidv4 } from "uuid";

import type { ToolError } from "../../extension/types";
import { sanitizeDiagnostic, redactDiagnosticText } from "../../shared/diagnostic-sanitizer";
import { truncate } from "../../shared/utils";
import { ErrorDefinitions, type ErrorCategory } from "./definitions";
import { diagnosticId, diagnosticCode, summarizeContext, summarizeError } from "./report-summary";

// --- 错误上报模块 ---

export interface ErrorReporterConfig {
    enabled: boolean; // 是否启用上报
    pasteServiceUrl?: string; // 可配置的上-报链接
    includeSensitiveInfo?: boolean;
    includeCookies?: boolean;
    includeSystemInfo?: boolean; // 是否包含系统信息
}

export const ErrorReporterConfigSchema = Schema.object({
    enabled: Schema.boolean().default(true).description("是否启用错误上报（默认仅上传脱敏技术摘要）"),
    pasteServiceUrl: Schema.string().role("link").default("https://dump.yesimbot.chat/").description("错误上报服务的 URL"),
    includeSensitiveInfo: Schema.boolean()
        .default(false)
        .description("包含详细诊断信息（可能包含对话、模型响应、错误原文和堆栈；凭据保留首尾各 4 字符，短凭据全部遮盖）"),
    includeCookies: Schema.boolean().default(false).description("详细诊断中包含 Cookie（保留首尾各 4 字符，其余用 * 遮盖；短 Cookie 全部遮盖）"),
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
    private disposed = false;

    constructor(
        config: ErrorReporterConfig,
        logger: Logger,
        private readonly saveLocal?: (errorId: string, error: Error) => Promise<void>,
        private readonly knownSecrets: readonly string[] = [],
    ) {
        this.config = {
            includeSensitiveInfo: false,
            includeCookies: false,
            includeSystemInfo: true,
            ...config,
            enabled: config.enabled ?? false,
        };
        this.logger = logger;

        if (this.config.enabled && !this.config.pasteServiceUrl) {
            this.logger.warn("已启用上报但未配置 pasteServiceUrl，上报功能将不会生效。");
        }
    }

    public dispose(): void {
        this.disposed = true;
    }

    /**
     * 格式化并上报错误
     * @param context 包含错误和附加上下文的对象
     */
    public async report(context: ReportContext): Promise<string | null> {
        if (this.disposed) return null;
        // 本地保存不依赖远程上报开关，也不等待远程服务。
        if (this.saveLocal) {
            try {
                await this.saveLocal(context.errorId, context.error);
            } catch {
                this.logger.warn("本地错误报告保存失败");
            }
        }
        if (this.disposed || !this.config.enabled || !this.config.pasteServiceUrl) {
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
            return null;
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
        const error = normalizeAppError(context.error);
        // Credential filtering includes nested Error fields and additionalInfo before
        // applying the stricter outbound content policy. Neither step mutates inputs.
        const detailed = !!this.config.includeSensitiveInfo;
        const privacy = { partialCredentials: detailed, includeCookies: !!this.config.includeCookies };
        const cleaned = sanitizeDiagnostic({ ...context, error }, this.knownSecrets, new Set(), 0, "", privacy);
        const packageJson = require("koishi-plugin-yesimbot/package.json");
        const dump = [
            `# 智能体错误报告\n`,
            `**ID:** \`${diagnosticId(cleaned.errorId)}\`\n`,
            `**时间 (UTC):** \`${new Date().toISOString()}\`\n`,
            `**插件版本:** \`${packageJson.version || "N/A"}\`\n`,
            `**错误码:** \`${diagnosticCode(cleaned.error.code)}\`\n`,
            `---`,
            detailed ? `## 详细诊断\n` : `## 技术摘要\n`,
            "```json\n" +
                JSON.stringify(
                    {
                        error: detailed ? cleaned.error : summarizeError(cleaned.error),
                        additionalInfo: detailed ? cleaned.additionalInfo : summarizeContext(cleaned.additionalInfo),
                        ...(this.config.includeSystemInfo
                            ? { systemInfo: { nodeVersion: process.version, platform: process.platform, architecture: process.arch } }
                            : {}),
                    },
                    null,
                    2,
                ) +
                "\n```",
            detailed
                ? `\n详细诊断已启用；凭据仅保留首尾各 4 字符，短凭据全部遮盖。Cookie ${privacy.includeCookies ? "经遮盖后包含" : "省略"}。`
                : `\n对话、模型响应、自由文本错误信息及完整堆栈默认省略；需要完整排障信息时请检查已启用的本地日志。`,
        ].join("\n");
        // Defense in depth also covers identifiers and serialization escape forms.
        return redactDiagnosticText(dump, this.knownSecrets, privacy);
    }
}

// --- 统一错误处理器 ---

// Ownership is attached to proxy identities, never names (Koishi can reuse names).
const loggerReporters = new WeakMap<Logger, ErrorReporter>();
let globalErrorReporter: ErrorReporter | null = null;

export function bindErrorReporter(logger: Logger, reporter: ErrorReporter): Logger {
    loggerReporters.set(logger, reporter);
    return logger;
}

/** Legacy explicit singleton API. Core instances use logger ownership instead. */
export function initializeErrorReporter(
    config: ErrorReporterConfig,
    logger: Logger,
    saveLocal?: (errorId: string, error: Error) => Promise<void>,
    knownSecrets: readonly string[] = [],
) {
    globalErrorReporter = new ErrorReporter(config, logger, saveLocal, knownSecrets);
}

export interface ErrorDefinitionValue {
    code: string;
    message: string | ((...args: any[]) => string);
    suggestion: string | ((...args: any[]) => string);
    category?: ErrorCategory;
    retryable?: boolean;
}

export class AppError extends Error {
    public readonly code: string;
    public readonly suggestion: string;
    public readonly errorId: string;
    public readonly category: ErrorCategory;
    public readonly retryable: boolean;

    public context?: Record<string, any>;

    constructor(
        definition: ErrorDefinitionValue,
        options?: {
            context?: Record<string, any>;
            cause?: unknown;
            errorId?: string;
            args?: any[];
        },
    ) {
        let message: string;
        let suggestion: string;

        if (typeof definition.message === "function") {
            message = (definition.message as any).apply(null, options?.args || []);
        } else {
            message = definition.message;
        }

        if (typeof definition.suggestion === "function") {
            suggestion = (definition.suggestion as any).apply(null, options?.args || []);
        } else {
            suggestion = definition.suggestion;
        }

        super(message, { cause: options?.cause });

        this.name = "AppError";
        this.code = definition.code;
        this.suggestion = suggestion;
        this.context = options?.context;
        this.errorId = options?.errorId ?? uuidv4();
        this.category = definition.category ?? "internal";
        this.retryable = definition.retryable ?? false;

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
    const appError = normalizeAppError(error);

    const { errorId, message, suggestion, context, stack } = appError;

    // 步骤 2: 分层记录日志
    // 第一层：面向用户/管理员的清晰错误报告 (ERROR 级别)
    const diagnostics = Object.fromEntries(Object.entries(summarizeContext(sanitizeDiagnostic(context))).filter(([, value]) => typeof value === "number"));
    const report = [
        `🛑 [错误报告] ID: ${diagnosticId(errorId)} | 错误码: ${diagnosticCode(appError.code)}`,
        `   - 环节: ${truncate(contextDescription, 120)}`,
        `   - 详情: ${truncate(message, 500)}`,
        `   - 建议: ${truncate(suggestion, 500)}`,
    ];
    if (Object.keys(diagnostics).length > 0) report.push(`   - 诊断摘要: ${truncate(JSON.stringify(diagnostics), 1000)}`);
    logger.error(report.join("\n"));

    // 第二层：面向开发者的详细调试信息 (DEBUG 级别，避免日志泛滥)
    const devContext = { ...context };
    // 对可能很长的原始响应进行截断，防止刷屏
    if (devContext.rawResponse) {
        devContext.rawResponse = truncate(devContext.rawResponse as string, 200) + "... (完整响应见已启用的本地日志)";
    }
    if (Object.keys(devContext).length > 0) {
        logger.debug(`   - 调试上下文: ${JSON.stringify(sanitizeDiagnostic(devContext))}`);
    }
    // 堆栈信息使用 DEBUG 级别，仅在需要时通过调整日志等级查看
    // logger.debug(`   - 堆栈追踪:\n${stack}`);
    if (appError.cause) {
        //@ts-ignore
        logger.debug(`   - 根本原因: ${appError.cause.message}\n${appError.cause.stack}`);
    } else {
        logger.debug(`   - 堆栈追踪:\n${stack}`);
    }

    // An owned logger always keeps its reporter, even after that owner stops.
    const reporter = loggerReporters.get(logger) ?? globalErrorReporter;
    if (reporter) {
        void reporter.report({
            errorId,
            error: appError,
        });
    } else {
        logger.debug(`   - 追踪: 此错误未上报，如需查看更多信息，请打开 DEBUG 日志查看堆栈信息`);
    }

    return errorId;
}

export * from "./definitions";

const errorCatalog = new Map<string, ErrorDefinitionValue>(
    Object.values(ErrorDefinitions).flatMap((domain) => Object.values(domain).map((definition) => [definition.code, definition] as const)),
);
const boundedText = (value: unknown, limit: number): value is string => typeof value === "string" && value.length > 0 && value.length <= limit;

/** The validated fields available across package copies or serialized transport. */
export interface AppErrorEnvelope {
    name: "AppError";
    code: string;
    message: string;
    suggestion: string;
    errorId: string;
    category?: ErrorCategory;
    retryable?: boolean;
}

/** Validates a transported/duplicate-package AppError envelope, never a bare code. */
export function isAppError(value: unknown): value is AppError | AppErrorEnvelope {
    if (value instanceof AppError) return true;
    if (!value || typeof value !== "object") return false;
    const error = value as Record<string, unknown>;
    const definition = typeof error.code === "string" ? errorCatalog.get(error.code) : undefined;
    return (
        !!definition &&
        error.name === "AppError" &&
        boundedText(error.message, 4096) &&
        boundedText(error.suggestion, 4096) &&
        typeof error.errorId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(error.errorId) &&
        (error.category === undefined || error.category === definition.category) &&
        (error.retryable === undefined || error.retryable === ("retryable" in definition ? definition.retryable : false))
    );
}

/** Internal normalization retains the original thrown value as cause. */
export function normalizeAppError(error: unknown): AppError {
    if (isAppError(error)) {
        if (error instanceof AppError) return error;
        return new AppError(errorCatalog.get(error.code)!, { errorId: error.errorId, cause: error });
    }
    return new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, { cause: error });
}

/** Public allowlist projection. Dynamic diagnostic arguments never cross this boundary. */
export function fromAppError(error: AppError): ToolError {
    const normalized = normalizeAppError(error);
    const definition = errorCatalog.get(normalized.code) ?? ErrorDefinitions.SYSTEM.UNKNOWN;
    return {
        name: "AppError",
        code: definition.code,
        message: typeof definition.message === "string" ? definition.message : `操作失败（${definition.code}）`,
        suggestion: typeof definition.suggestion === "string" ? definition.suggestion : "请检查配置与日志后重试",
        errorId: normalized.errorId,
        category: definition.category,
        retryable: "retryable" in definition ? definition.retryable : false,
    };
}

/** Normalize a thrown value; explicit legacy ToolError results continue through Failed unchanged. */
export function toToolError(error: unknown): ToolError {
    return fromAppError(normalizeAppError(error));
}
