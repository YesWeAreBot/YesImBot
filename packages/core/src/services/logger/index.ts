import { format } from "util";

import { Context, Logger, Schema, Service } from "koishi";

import { Config } from "../../config";
import { Services } from "../../shared/constants";
import { LocalLogWriter, LocalLoggingConfig, sanitizeLog } from "./local-writer";

/**
 * 定义日志的详细级别，与 Koishi (reggol) 的模型对齐。
 * 数值越大，输出的日志越详细。
 */
export enum LogLevel {
    // 级别 0: 完全静默，不输出任何日志
    SILENT = 0,
    // 级别 1: 只显示最核心的成功/失败信息
    ERROR = 1,
    // 级别 2: 显示常规信息、警告以及更低级别的所有信息
    INFO = 2,
    // 级别 3: 显示所有信息，包括详细的调试日志
    DEBUG = 3,
}

export interface LoggingConfig {
    level: LogLevel;
    local?: LocalLoggingConfig;
}

export const LoggingConfigSchema: Schema<LoggingConfig> = Schema.object({
    local: Schema.object({
        enabled: Schema.boolean().default(false).description("保存本地调试日志和完整错误报告"),
        directory: Schema.string().default("data/yesimbot/debug_logs").description("日志目录，相对路径以 Koishi 工作目录为准"),
        level: Schema.union([1, 2, 3]).default(3).description("本地日志级别：1 错误 / 2 常规 / 3 调试，独立于控制台"),
        maxFileSizeMB: Schema.number().min(1).max(1024).default(10).description("单文件轮换大小（MB），一条完整记录可超出此值"),
        maxFiles: Schema.natural().min(1).max(1000).default(20).description("最多保留的日志文件数"),
        retentionDays: Schema.natural().max(3650).default(7).description("保留天数，0 表示仅按文件数清理"),
    })
        .collapse()
        .description("本地日志（可能包含对话内容，请妥善保管）"),
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
    write?: (name: string, level: number, method: string, args: any[]) => void,
): Logger {
    logger.level = configuredLevel;

    // 映射到 reggol 的实际级别值
    const methodLevels: Record<string, number> = {
        success: 1,
        error: 1,
        info: 2,
        warn: 2,
        debug: 3,
    };

    return new Proxy(logger, {
        get(target, prop, receiver) {
            const propName = prop.toString();

            // 处理 extend 方法 (逻辑不变)
            if (propName === "extend") {
                const originalExtend = Reflect.get(target, prop, receiver);
                return (...args: any[]) => {
                    const newLogger = originalExtend.apply(target, args);
                    return createLevelAwareLoggerProxy(newLogger, configuredLevel, write);
                };
            }

            // 处理日志方法
            if (propName in methodLevels) {
                const methodLevel = methodLevels[propName];

                const originalMethod = Reflect.get(target, prop, receiver);
                return (...args: any[]) => {
                    try {
                        write?.(target.name, methodLevel, propName, args);
                    } catch {}
                    if (methodLevel <= configuredLevel) return originalMethod.apply(target, args);
                };
            }

            // 转发其他所有属性 (逻辑不变)
            return Reflect.get(target, prop, receiver);
        },
    });
}
declare module "koishi" {
    interface Context {
        [Services.Logger]: LoggerService;
    }
}

export class LoggerService extends Service<Config> {
    _logger: Logger;
    private localWriter?: LocalLogWriter;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Logger, true);
        this.ctx = ctx;
        this.config = config;
        if (config.logging.local?.enabled) {
            this.localWriter = new LocalLogWriter(
                ctx.baseDir,
                config.logging.local,
                (message) => ctx.logger("[本地日志]").warn(message),
                config.providers?.map((provider) => provider.apiKey).filter(Boolean),
            );
        }
        this._logger = createLevelAwareLoggerProxy(ctx.logger("[日志服务]"), config.logging.level, this.writeLocal.bind(this));
    }

    protected start(): void {
        //this._logger.info("服务已启动");
    }

    protected async stop(): Promise<void> {
        await this.localWriter?.close();
    }

    private writeLocal(name: string, level: number, method: string, args: any[]): void {
        if (!this.localWriter || level > (this.config.logging.local?.level ?? Infinity)) return;
        void this.localWriter.write({
            timestamp: new Date().toISOString(),
            name,
            level: method,
            message: format(...args.map((value) => sanitizeLog(value))),
            arguments: args,
        });
    }

    public async recordError(errorId: string, error: Error): Promise<void> {
        if (!this.localWriter) return;
        await this.localWriter.write({ timestamp: new Date().toISOString(), level: "error", errorId, error });
        this.ctx.logger("[本地日志]").info(`错误 ${errorId} 的本地日志目录：${this.localWriter.directory}`);
    }

    /** @deprecated */
    public getLogger(name?: string): Logger {
        const originalLogger = this.ctx?.logger(name as string) || new Logger(name ?? "", {});
        return createLevelAwareLoggerProxy(originalLogger, this.config.logging.level, this.writeLocal.bind(this));
    }
}
