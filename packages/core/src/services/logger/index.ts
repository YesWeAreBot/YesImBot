import { Service, Logger, Context, Schema } from "koishi";
import { Services } from "../types";

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
}

export const LoggingConfigSchema: Schema<LoggingConfig> = Schema.object({
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

function createLevelAwareLoggerProxy(logger: Logger, configuredLevel: LogLevel): Logger {
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
                    return createLevelAwareLoggerProxy(newLogger, configuredLevel);
                };
            }

            // 处理日志方法
            if (propName in methodLevels) {
                const methodLevel = methodLevels[propName];

                // 检查方法的详细度是否在用户配置的允许范围内
                if (methodLevel <= configuredLevel) {
                    const originalMethod = Reflect.get(target, prop, receiver);
                    return originalMethod.bind(target);
                } else {
                    // 方法的详细度太高，超出配置范围，忽略它
                    return () => {};
                }
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
        const originalLogger = this.ctx?.logger(name) || new Logger(name, {});
        return createLevelAwareLoggerProxy(originalLogger, this.config.level);
    }
}
