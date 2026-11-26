import { Logger, Schema } from "koishi";
import { v4 as uuidv4 } from "uuid";

import type { ToolError } from "../../extension/types";
import type { ConversationReport } from "../../logger/conversation-report";
import { sanitizeDiagnostic, redactDiagnosticText } from "../../shared/diagnostic-sanitizer";
import { truncate } from "../../shared/utils";
import { conversationMask, conversationReportSecrets } from "./conversation-privacy";
import { ErrorDefinitions, type ErrorCategory } from "./definitions";
import { diagnosticId, diagnosticCode, summarizeContext, summarizeError } from "./report-summary";

// --- 错误上报模块 ---

const reportLevels = ["lite", "low", "medium", "full", "full-all"] as const;
type ReportLevel = (typeof reportLevels)[number];

export interface ErrorReporterConfig {
    enabled: boolean; // 是否启用上报
    pasteServiceUrl?: string; // 可配置的上-报链接
    level?: ReportLevel;
    includeSensitiveInfo?: boolean;
    conversationDetails?: "off" | "masked" | "raw";
    includeCookies?: boolean;
    includeSystemInfo?: boolean; // 是否包含系统信息
}

export const ErrorReporterConfigSchema = Schema.object({
    enabled: Schema.boolean().default(true).description("是否启用错误上报（默认仅上传脱敏技术摘要）"),
    pasteServiceUrl: Schema.string().role("link").default("https://dump.yesimbot.chat/").description("错误上报服务的 URL"),
    level: Schema.union([
        Schema.const("lite").description("仅错误简报"),
        Schema.const("low").description("错误详情和堆栈"),
        Schema.const("medium").description("错误详情、堆栈和模型响应"),
        Schema.const("full").description("加入简洁对话上下文"),
        Schema.const("full-all").description("全部轮次诊断，包括 System 提示词和模型请求"),
    ]).description("错误上报级别（未设置时兼容旧配置）"),
    includeSensitiveInfo: Schema.boolean().default(false).hidden(),
    conversationDetails: Schema.union([
        Schema.const("off").description("沿用级别默认值"),
        Schema.const("masked").description("遮盖会话身份标识"),
        Schema.const("raw").description("保留会话身份标识"),
    ])
        .default("off")
        .description("会话身份脱敏"),
    includeCookies: Schema.boolean().default(false).hidden(),
    includeSystemInfo: Schema.boolean().default(true).description("是否包含系统信息"),
});

export function shouldCaptureReportConversation(config?: ErrorReporterConfig): boolean {
    return config?.level ? reportLevels.indexOf(config.level) >= 2 : config?.conversationDetails === "masked" || config?.conversationDetails === "raw";
}

function jsonSection(title: string, value: unknown): string {
    return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value ?? null, null, 2).replace(/`/g, "\\u0060")}\n\`\`\`
`;
}

export interface ReportContext {
    errorId: string;
    error: Error;
    additionalInfo?: Record<string, any>;
    conversation?: ConversationReport;
}

const errorDetails = (row: any): unknown =>
    row && typeof row === "object"
        ? {
              ...(summarizeError(row) as Record<string, unknown>),
              message: row.message,
              stack: row.stack,
              cause: errorDetails(row.cause),
              errors: Array.isArray(row.errors) ? row.errors.map(errorDetails) : undefined,
          }
        : row;

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
        private readonly saveLocal?: (errorId: string, error: Error, conversation?: ConversationReport) => Promise<void>,
        private readonly knownSecrets: readonly string[] = [],
        private readonly captureConversation?: () => ConversationReport | undefined,
        private readonly recordDiagnostic?: (errorId: string, error: unknown) => void,
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
        const reportId = diagnosticId(redactDiagnosticText(context.errorId, this.knownSecrets));
        try {
            this.recordDiagnostic?.(reportId, context.error);
        } catch {
            this.logger.warn(`错误 ${reportId} · 无法记录对话追踪`);
        }
        let conversation: ConversationReport | undefined;
        let mask: ReturnType<typeof conversationMask> | undefined;
        let secrets = this.knownSecrets;
        if (shouldCaptureReportConversation(this.config)) {
            try {
                const snapshot = context.conversation ?? this.captureConversation?.();
                secrets = conversationReportSecrets([snapshot, context.error, context.additionalInfo], secrets);
                if (snapshot) {
                    const cleaned: ConversationReport = sanitizeDiagnostic(snapshot, secrets);
                    conversation = cleaned;
                }
            } catch {
                conversation = undefined;
                this.logger.warn(`错误 ${reportId} · 无法生成会话诊断`);
            }
        }

        if (this.config.level ? this.config.conversationDetails !== "raw" : this.config.conversationDetails === "masked") {
            try {
                mask = conversationMask(conversation ?? { entries: [], identities: [], omitted: 0 }, context.error, context.additionalInfo);
                if (conversation) conversation = mask(conversation);
            } catch {
                this.logger.warn(`错误 ${reportId} · 无法脱敏，已跳过报告保存和上传`);
                return null;
            }
        }

        // 本地保存不依赖远程上报开关，也不等待远程服务。
        if (this.saveLocal) {
            try {
                const cleanedError = conversation || mask ? sanitizeDiagnostic(context.error, secrets) : context.error;
                const error = mask ? mask(cleanedError) : cleanedError;
                if (conversation) await this.saveLocal(context.errorId, error, conversation);
                else await this.saveLocal(context.errorId, error);
            } catch {
                this.logger.warn(`错误 ${reportId} · 本地报告保存失败`);
            }
        }
        if (this.disposed || !this.config.enabled) return null;
        if (!this.config.pasteServiceUrl) {
            this.logger.warn(`错误 ${reportId} · 未上报，缺少服务地址`);
            return null;
        }

        let dump: string;
        try {
            dump = this.formatErrorDump({ ...context, conversation }, secrets, mask);
        } catch {
            this.logger.error(`错误 ${reportId} · 远程上报失败，无法生成报告`);
            return null;
        }
        const url = await this.uploadToPaste(reportId, dump);
        if (url) this.logger.info(`错误 ${reportId} · 已上报，可通过 ${redactDiagnosticText(url, secrets)} 查看详细信息`);
        return url;
    }

    private async uploadToPaste(reportId: string, content: string): Promise<string | null> {
        const failure = (reason: string) => {
            this.logger.error(`错误 ${reportId} · 远程上报失败，${reason}`);
            return null;
        };
        const formData = new FormData();
        formData.append("c", content);
        const signal = AbortSignal.timeout(15_000);
        try {
            const response = await fetch(this.config.pasteServiceUrl!, { method: "POST", body: formData, signal, redirect: "manual" });
            if (!response.ok) return failure(`HTTP ${response.status}`);
            let data: unknown;
            try {
                data = await response.json();
            } catch {
                return failure(signal.aborted ? "读取上报结果超时" : "服务返回的结果不是有效 JSON");
            }
            const link = data && typeof data === "object" && "url" in data ? data.url : undefined;
            if (typeof link !== "string" || !/^https?:\/\//i.test(link)) return failure("服务未返回有效报告链接");
            const url = URL.parse(link);
            if (!url || url.username || url.password || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(link)) return failure("服务未返回有效报告链接");
            return url.href;
        } catch (error) {
            const code = error?.cause?.code;
            const reason =
                typeof code === "string" && /^(?:EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/.test(code)
                    ? `无法连接上报服务（${code}）`
                    : "无法连接上报服务";
            return failure(signal.aborted ? "连接上报服务超时" : reason);
        }
    }

    private formatErrorDump(context: ReportContext, secrets: readonly string[], mask?: ReturnType<typeof conversationMask>): string {
        if (this.config.level) return this.formatLeveledDump(context, secrets, mask);
        const error = normalizeAppError(context.error);
        // Credential filtering includes nested Error fields and additionalInfo before
        // applying the stricter outbound content policy. Neither step mutates inputs.
        const detailed = !!this.config.includeSensitiveInfo || !!context.conversation;
        const privacy = { partialCredentials: !context.conversation && detailed, includeCookies: !!this.config.includeCookies };
        const cleaned = sanitizeDiagnostic({ errorId: context.errorId, additionalInfo: context.additionalInfo, error }, secrets, new Set(), 0, "", privacy);
        if (mask) {
            cleaned.error = mask(cleaned.error);
            cleaned.additionalInfo = mask(cleaned.additionalInfo);
        }
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
                        ...(context.conversation ? { conversation: context.conversation } : {}),
                        ...(this.config.includeSystemInfo
                            ? { systemInfo: { nodeVersion: process.version, platform: process.platform, architecture: process.arch } }
                            : {}),
                    },
                    null,
                    2,
                ) +
                "\n```",
            context.conversation
                ? `\n会话诊断已附带，凭据已遮盖。`
                : detailed
                  ? `\n详细诊断已启用；凭据仅保留首尾各 4 字符，短凭据全部遮盖。Cookie ${privacy.includeCookies ? "经遮盖后包含" : "省略"}。`
                  : `\n对话、模型响应、自由文本错误信息及完整堆栈默认省略；需要完整排障信息时请检查已启用的本地日志。`,
        ].join("\n");
        // Defense in depth also covers identifiers and serialization escape forms.
        return context.conversation ? dump : redactDiagnosticText(dump, secrets, privacy);
    }
    private formatLeveledDump(context: ReportContext, secrets: readonly string[], mask?: ReturnType<typeof conversationMask>): string {
        const level = reportLevels.indexOf(this.config.level!);
        const error = sanitizeDiagnostic(normalizeAppError(context.error), secrets);
        const safeError = mask ? mask(error) : error;
        const sections = [
            `# 智能体错误报告 · ${this.config.level}\n\n`,
            jsonSection("错误", {
                id: diagnosticId(redactDiagnosticText(context.errorId, secrets)),
                error: level === 0 ? summarizeError(safeError) : errorDetails(safeError),
            }),
        ];
        const rows = context.conversation?.entries ?? [];
        const entries = (kind: string) => rows.filter((row) => row.kind === kind);
        if (level >= 2) sections.push(jsonSection("模型响应", entries("model.response").length ? entries("model.response") : "未采集到模型响应"));
        if (level === 3) {
            const latest = entries("conversation.input").at(-1)?.data as
                | { channelId?: string; channelName?: string; messages?: Array<{ userId: string; messageId: string; nickname: string; content: string }> }
                | undefined;
            const lines = Array.isArray(latest?.messages)
                ? latest.messages.map((row) =>
                      [row.userId, row.messageId, row.nickname, row.content]
                          .map((value) =>
                              String(value ?? "")
                                  .replace(/\r?\n/g, " ")
                                  .replace(/\`/g, "′"),
                          )
                          .join(" - "),
                  )
                : [];
            const channel = latest?.channelId ?? context.conversation?.identities.find(({ kind }) => kind === "channel")?.id ?? "未知";
            sections.push(
                `## 对话上下文\n\n会话 ${JSON.stringify(channel)}${latest?.channelName ? ` - ${JSON.stringify(latest.channelName)}` : ""}\n\n\`\`\`text\n${lines.join("\n") || "未采集到对话上下文"}\n\`\`\`\n`,
            );
        }
        if (level === 4) {
            const requests = rows.filter((row) => row.kind === "model.request" || row.kind === "model.provider_request");
            const system = requests.map(({ data }) => {
                const request = data as { requestId?: string; wireRequest?: number; payload?: any };
                const { payload } = request;
                return {
                    requestId: request.requestId,
                    wireRequest: request.wireRequest,
                    system:
                        payload?.system ??
                        payload?.systemInstruction ??
                        payload?.instructions ??
                        (Array.isArray(payload?.messages) ? payload.messages.filter((message: any) => message?.role === "system") : undefined),
                };
            });
            sections.push(
                jsonSection("System 提示词", system.length ? system : "未采集到模型请求"),
                jsonSection("模型请求", requests),
                jsonSection(
                    "轮次追踪与工具回执",
                    rows.filter((row) => !requests.includes(row) && row.kind !== "model.response"),
                ),
                jsonSection("详细错误", {
                    error: safeError,
                    additionalInfo: mask ? mask(sanitizeDiagnostic(context.additionalInfo, secrets)) : sanitizeDiagnostic(context.additionalInfo, secrets),
                }),
            );
        }
        if (level >= 2 && context.conversation?.omitted) sections.push(`遗漏追踪条目 ${context.conversation.omitted} 条。\n`);
        if (level >= 1 && this.config.includeSystemInfo)
            sections.push(jsonSection("系统信息", { nodeVersion: process.version, platform: process.platform, architecture: process.arch }));
        return sections.join("\n");
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

    const { errorId, message, suggestion, context } = appError;

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
        devContext.rawResponse = truncate(devContext.rawResponse as string, 200) + "...（预览，完整内容取决于追踪配置）";
    }
    if (Object.keys(devContext).length > 0) {
        logger.debug(`   - 调试上下文: ${JSON.stringify(sanitizeDiagnostic(devContext))}`);
    }
    const diagnostic = sanitizeDiagnostic(appError);
    logger.debug(`   - 堆栈追踪:\n${JSON.stringify({ stack: diagnostic.stack, cause: diagnostic.cause }, null, 2)}`);

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
