import { Context, Logger } from "koishi";

/**
 * 工具管理器专用日志系统
 * 提供结构化、分类的日志输出
 */
export class ToolLogger {
    private logger: Logger;
    private performanceLogger: Logger;
    private securityLogger: Logger;

    constructor(ctx: Context, private logLevel: string = "info") {
        this.logger = ctx.logger("tool-manager");
        this.performanceLogger = ctx.logger("tool-perf");
        this.securityLogger = ctx.logger("tool-security");
    }

    /**
     * 基础日志方法
     */
    debug(category: string, message: string, ...args: any[]): void {
        this.logger.debug(`[${category}] ${message}`, ...args);
    }

    info(category: string, message: string, ...args: any[]): void {
        this.logger.info(`[${category}] ${message}`, ...args);
    }

    warn(category: string, message: string, ...args: any[]): void {
        this.logger.warn(`[${category}] ${message}`, ...args);
    }

    error(category: string, message: string, error?: any): void {
        if (error instanceof Error) {
            this.logger.error(`[${category}] ${message}: ${error.message}`);
            if (error.stack) {
                this.logger.debug(`[${category}] Stack trace:`, error.stack);
            }
        } else {
            this.logger.error(`[${category}] ${message}`, error);
        }
    }

    success(category: string, message: string, ...args: any[]): void {
        this.logger.success(`[${category}] ${message}`, ...args);
    }

    /**
     * 扩展加载日志
     */
    extensionLoaded(fileName: string, toolCount: number): void {
        this.success("Loader", `✓ 扩展加载成功: ${fileName} (${toolCount} 个工具)`);
    }

    extensionLoadError(fileName: string, error: Error): void {
        this.error("Loader", `✗ 扩展加载失败: ${fileName}`, error);
    }

    /**
     * 工具注册日志
     */
    toolRegistered(name: string, version: string, category?: string): void {
        const categoryInfo = category ? ` [${category}]` : "";
        this.success("Registry", `✓ 工具注册成功: ${name}@${version}${categoryInfo}`);
    }

    toolUnregistered(name: string): void {
        this.info("Registry", `✓ 工具注销成功: ${name}`);
    }

    toolRegistrationError(name: string, error: Error): void {
        this.error("Registry", `✗ 工具注册失败: ${name}`, error);
    }

    /**
     * 工具执行日志
     */
    toolExecutionStart(functionName: string, params: Record<string, unknown>): void {
        const paramStr = this.formatParams(params);
        this.info("Executor", `→ 开始执行工具: ${functionName}(${paramStr})`);
    }

    toolExecutionSuccess(functionName: string, executionTime: number, result?: any): void {
        const resultPreview = this.formatResult(result);
        this.success("Executor", `← 工具执行成功: ${functionName} (${executionTime}ms)${resultPreview}`);

        // 性能日志
        if (executionTime > 5000) {
            this.performanceLogger.warn(`工具 ${functionName} 执行时间过长: ${executionTime}ms`);
        }
    }

    toolExecutionError(functionName: string, executionTime: number, error: string): void {
        this.error("Executor", `← 工具执行失败: ${functionName} (${executionTime}ms) - ${error}`);
    }

    toolRetry(functionName: string, retryCount: number, maxRetries: number): void {
        this.warn("Executor", `工具重试: ${functionName} (${retryCount}/${maxRetries})`);
    }

    /**
     * 安全相关日志
     */
    securityViolation(functionName: string, reason: string, params?: Record<string, unknown>): void {
        const paramStr = params ? ` - 参数: ${this.formatParams(params)}` : "";
        this.securityLogger.warn(`安全违规: ${functionName} - ${reason}${paramStr}`);
    }

    /**
     * 格式化工具参数用于日志输出
     */
    private formatParams(params: Record<string, unknown>): string {
        const items: string[] = [];
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === "string") {
                // 对于字符串参数，限制长度并隐藏敏感信息
                const safeValue = this.sanitizeValue(key, value);
                items.push(`${key}="${safeValue}"`);
            } else {
                items.push(`${key}=${JSON.stringify(value)}`);
            }
        }
        return items.join(", ");
    }

    /**
     * 格式化执行结果用于日志输出
     */
    private formatResult(result: any): string {
        if (result === undefined || result === null) {
            return "";
        }

        const preview = typeof result === "string" ? result.substring(0, 100) : JSON.stringify(result).substring(0, 100);

        return ` -> ${preview}${preview.length >= 100 ? "..." : ""}`;
    }

    /**
     * 清理敏感信息
     */
    private sanitizeValue(key: string, value: string): string {
        const sensitiveKeys = ["password", "token", "key", "secret", "auth"];
        const isSensitive = sensitiveKeys.some((k) => key.toLowerCase().includes(k));

        if (isSensitive) {
            return "*".repeat(Math.min(value.length, 8));
        }

        return value.length > 50 ? value.substring(0, 50) + "..." : value;
    }
}
