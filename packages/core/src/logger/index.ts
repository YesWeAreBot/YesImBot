import { format } from "util";

import { Context, Logger, Schema } from "koishi";

import { Config } from "../config";
import { sanitizeDiagnostic } from "../shared/diagnostic-sanitizer";
import { bindErrorReporter, ErrorReporter } from "../shared/errors";
import { YesImBotService } from "../shared/service";
import { conversationLogPrefix, formatLogTarget } from "./conversation";
import { ConversationReportRecorder, recordConversationReport, type ConversationReport, type ReportTarget } from "./conversation-report";
import { LocalLogWriter, LocalLoggingConfig, sanitizeLog } from "./local-writer";

/**
 * 定义日志的详细级别，与 Koishi (reggol) 的模型对齐。
 * 数值越大，输出的日志越详细。
 */
export enum LogLevel {
    // 级别 0: 完全静默，不输出任何日志
    SILENT = 0,
    // 级别 1: 只显示错误信息
    ERROR = 1,
    // 级别 2: 显示常规信息、警告以及更低级别的所有信息
    INFO = 2,
    // 级别 3: 显示所有信息，包括详细的调试日志
    DEBUG = 3,
}

export interface LoggingConfig {
    level: LogLevel;
    local?: LocalLoggingConfig;
    traceToConsole?: boolean;
}

export const LoggingConfigSchema: Schema<LoggingConfig> = Schema.object({
    local: Schema.object({
        enabled: Schema.boolean().default(false).description("保存本地调试日志和完整错误报告"),
        directory: Schema.string().default("data/yesimbot/debug_logs").description("日志目录，相对路径以 Koishi 工作目录为准"),
        level: Schema.union([1, 2, 3]).default(3).description("本地日志级别：1 错误 / 2 常规 / 3 调试，独立于控制台"),
        trace: Schema.boolean().default(false).description("另存完整对话追踪，含提示词、模型原文和工具结果"),
        maxFileSizeMB: Schema.number().min(1).max(1024).default(10).description("单文件轮换大小（MB），一条完整记录可超出此值"),
        maxFiles: Schema.natural().min(1).max(1000).default(20).description("最多保留的日志文件数"),
        retentionDays: Schema.natural().max(3650).default(7).description("保留天数，0 表示仅按文件数清理"),
    })
        .collapse()
        .description("本地日志（可能包含对话内容，请妥善保管）"),
    traceToConsole: Schema.boolean().default(false).description("在 DEBUG 控制台展开对话追踪，含提示词、模型原文及工具结果"),
    level: Schema.union([
        Schema.const(LogLevel.SILENT).description("SILENT"),
        Schema.const(LogLevel.ERROR).description("ERROR"),
        Schema.const(LogLevel.INFO).description("INFO"),
        Schema.const(LogLevel.DEBUG).description("DEBUG"),
    ]).default(LogLevel.INFO).description(`全局日志级别<br/>
    - SILENT: 完全静默，不输出任何日志<br/>
    - ERROR: 只显示错误信息<br/>
    - INFO: 显示错误、警告和常规信息<br/>
    - DEBUG: 显示所有信息，包括详细的调试日志`),
});

function createLevelAwareLoggerProxy(
    logger: Logger,
    configuredLevel: LogLevel,
    reporter: ErrorReporter,
    knownSecrets: readonly string[],
    write?: (name: string, level: number, method: string, args: any[], prefix?: string) => void,
): Logger {
    logger.level = configuredLevel;

    // 映射到 reggol 的实际级别值
    const methodLevels: Record<string, number> = {
        success: 2,
        error: 1,
        info: 2,
        warn: 2,
        debug: 3,
    };

    const proxy = new Proxy(logger, {
        get(target, prop, receiver) {
            const propName = prop.toString();

            // 处理 extend 方法 (逻辑不变)
            if (propName === "extend") {
                const originalExtend = Reflect.get(target, prop, receiver);
                return (...args: any[]) => {
                    const newLogger = originalExtend.apply(target, args);
                    return createLevelAwareLoggerProxy(newLogger, configuredLevel, reporter, knownSecrets, write);
                };
            }

            // 处理日志方法
            if (propName in methodLevels) {
                const methodLevel = methodLevels[propName];

                const originalMethod = Reflect.get(target, prop, receiver);
                return (...args: any[]) => {
                    const prefix = conversationLogPrefix();
                    try {
                        write?.(target.name, methodLevel, propName, args, prefix);
                    } catch {}
                    if (methodLevel > configuredLevel) return;
                    args = args.map((arg) => sanitizeDiagnostic(arg, knownSecrets));
                    if (!prefix) return originalMethod.apply(target, args);
                    if (args.length === 1 && typeof args[0] === "string" && !prefix.includes("%")) return originalMethod.call(target, `${prefix} ${args[0]}`);
                    if (typeof args[0] === "string") return originalMethod.call(target, `%s ${args[0]}`, prefix, ...args.slice(1));
                    return originalMethod.call(target, "%s", prefix, ...args);
                };
            }

            // 转发其他所有属性 (逻辑不变)
            return Reflect.get(target, prop, receiver);
        },
    });
    return bindErrorReporter(proxy, reporter);
}

export class LoggerService extends YesImBotService<Config> {
    _logger: Logger;
    private readonly knownSecrets: string[];
    private localWriter?: LocalLogWriter;
    private readonly errorReporter: ErrorReporter;
    private readonly conversationReports?: ConversationReportRecorder;

    constructor(ctx: Context, config: Config) {
        super(ctx, config);
        const search = config.extra?.search as { engines?: Array<{ apiKey?: string }> } | undefined;
        this.knownSecrets = [...(config.providers ?? []), ...(search?.engines ?? [])].flatMap(({ apiKey }) => (apiKey ? [apiKey] : []));
        if (config.logging.local?.enabled) {
            this.localWriter = new LocalLogWriter(ctx.baseDir, config.logging.local, (message) => ctx.logger("[本地日志]").warn(message), this.knownSecrets);
        }
        const traceToConsole = config.logging.traceToConsole && config.logging.level === LogLevel.DEBUG;
        const traceToFile = !!this.localWriter && config.logging.local?.trace && config.logging.local.level === LogLevel.DEBUG;
        const traceForReport =
            (config.errorReporting?.enabled || this.localWriter) && ["masked", "raw"].includes(config.errorReporting?.conversationDetails ?? "");
        if (traceToConsole || traceToFile || traceForReport) {
            const traceLogger = ctx.logger("[对话追踪]");
            if (traceToConsole) traceLogger.level = LogLevel.DEBUG;
            this.conversationReports = new ConversationReportRecorder((target, entry) => {
                if (entry.kind === "log") return; // Ordinary logs already use their configured sinks.
                const prefix = formatLogTarget(target);
                if (traceToFile) void this.localWriter?.write({ level: "debug", target, ...entry });
                if (traceToConsole) {
                    const safe = sanitizeDiagnostic({ prefix, ...entry }, this.knownSecrets);
                    traceLogger.debug("%s %s\n%s", safe.prefix, safe.kind, JSON.stringify(safe, null, 2));
                }
            });
        }
        this.errorReporter = new ErrorReporter(
            config.errorReporting,
            ctx.logger("[错误报告]"),
            (id, error, conversation) => (conversation ? this.recordError(id, error, conversation) : this.recordError(id, error)),
            this.knownSecrets,
            () => this.conversationReports?.snapshot(),
            (errorId, error) => {
                if (this.conversationReports) {
                    recordConversationReport("error", { errorId, diagnostic: sanitizeDiagnostic(error, this.knownSecrets) }, this.conversationReports);
                }
            },
        );
        this._logger = createLevelAwareLoggerProxy(
            ctx.logger("[日志服务]"),
            config.logging.level,
            this.errorReporter,
            this.knownSecrets,
            this.writeLocal.bind(this),
        );
    }

    public start(): void {
        //this._logger.info("服务已启动");
    }

    public async stop(): Promise<void> {
        this.errorReporter.dispose();
        this.conversationReports?.stop();
        await this.localWriter?.close();
    }

    private writeLocal(name: string, level: number, method: string, args: any[], prefix?: string): void {
        if (this.conversationReports) recordConversationReport("log", { name, level: method, prefix, arguments: args }, this.conversationReports);
        if (!this.localWriter || level > (this.config.logging.local?.level ?? Infinity)) return;
        const message = format(...args.map((value) => sanitizeLog(value)));
        void this.localWriter.write({
            timestamp: new Date().toISOString(),
            name,
            level: method,
            message: prefix ? `${prefix} ${message}` : message,
            arguments: args,
        });
    }

    public startConversationReport(target: ReportTarget, turn?: string) {
        return this.conversationReports?.start(target, turn);
    }

    public clearConversationReports(matches: (platform: string, channelId: string, isDirect: boolean) => boolean): void {
        this.conversationReports?.clear(matches);
    }

    public async recordError(errorId: string, error: Error, conversation?: ConversationReport): Promise<void> {
        if (!this.localWriter) return;
        const file = await this.localWriter.writeWithReceipt({ timestamp: new Date().toISOString(), level: "error", errorId, error, conversation });
        const logger = this.ctx.logger("[本地日志]");
        const prefix = conversationLogPrefix();
        const subject = `${prefix ? `${prefix} ` : ""}错误 ${errorId}`;
        if (file) logger.info("%s", `${subject} · 本地报告已保存：${file}`);
        else logger.warn("%s", `${subject} · 本地报告未保存`);
    }

    /** @deprecated */
    public getLogger(name?: string): Logger {
        const originalLogger = this.ctx?.logger(name as string) || new Logger(name ?? "", {});
        return createLevelAwareLoggerProxy(originalLogger, this.config.logging.level, this.errorReporter, this.knownSecrets, this.writeLocal.bind(this));
    }
}
