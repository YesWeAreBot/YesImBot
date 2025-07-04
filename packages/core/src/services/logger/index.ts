import { Service, Logger, Context, Schema } from "koishi";
import { Services } from "../types";

export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
}

export interface LoggingConfig {
    level: LogLevel;
}

export const LoggingConfigSchema: Schema<LoggingConfig> = Schema.object({
    level: Schema.union([
        Schema.const(LogLevel.TRACE).description("TRACE"),
        Schema.const(LogLevel.DEBUG).description("DEBUG"),
        Schema.const(LogLevel.INFO).description("INFO"),
        Schema.const(LogLevel.WARN).description("WARN"),
        Schema.const(LogLevel.ERROR).description("ERROR"),
    ])
        .default(LogLevel.INFO)
        .description("全局日志级别"),
});

function createLevelAwareLoggerProxy(logger: Logger, configuredLevel: LogLevel): Logger {
    const methodLevels: Record<string, LogLevel> = {
        trace: LogLevel.TRACE,
        debug: LogLevel.DEBUG,
        info: LogLevel.INFO,
        warn: LogLevel.WARN,
        error: LogLevel.ERROR,
        success: LogLevel.INFO,
    };

    return new Proxy(logger, {
        get(target, prop, receiver) {
            const propName = prop.toString();

            if (propName === "extend") {
                const originalExtend = Reflect.get(target, prop, receiver);
                return (...args: any[]) => {
                    const newLogger = originalExtend.apply(target, args);
                    return createLevelAwareLoggerProxy(newLogger, configuredLevel);
                };
            }

            if (propName in methodLevels) {
                const methodLevel = methodLevels[propName];
                if (configuredLevel <= methodLevel) {
                    if (propName === "trace") {
                        return target.debug.bind(target);
                    }
                    const originalMethod = Reflect.get(target, prop, receiver);
                    return originalMethod.bind(target);
                } else {
                    return () => {};
                }
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

declare module "koishi" {
    interface Context {
        [Services.Logger]: LoggerService;
    }
}

export class LoggerService extends Service<LoggingConfig> {
    _logger: Logger;

    constructor(ctx: Context, config: LoggingConfig) {
        super(ctx, Services.Logger, true);
        this.ctx = ctx;
        this.config = config;
        this._logger = createLevelAwareLoggerProxy(ctx.logger("[日志服务]"), config.level);
    }

    protected start(): void {
        this._logger.info("服务已启动");
    }

    protected stop(): void {
        this._logger.info("服务已停止");
    }

    public getLogger(name?: string): Logger {
        const originalLogger = this.ctx.logger(name);
        return createLevelAwareLoggerProxy(originalLogger, this.config.level);
    }
}
