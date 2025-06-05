import { Context } from "koishi";

// 日志工具类
export class Logger {
    private ctx: Context;

    constructor(ctx: Context) {
        this.ctx = ctx;
    }

    info(message: string) {
        this.ctx.logger("🔥 MCP").info(message)
    }

    success(message: string) {
        this.ctx.logger("✅ MCP").success(message)
    }

    warn(message: string) {
        this.ctx.logger("⚠️ MCP").warn(message)
    }

    error(message: string) {
        this.ctx.logger("❌ MCP").error(message)
    }

    debug(message: string) {
        this.ctx.logger("🔍 MCP").debug(message)
    }
}
