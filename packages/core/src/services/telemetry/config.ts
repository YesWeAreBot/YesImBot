import Sentry from "@sentry/node";
import { Schema } from "koishi";

export interface TelemetryConfig extends Sentry.NodeOptions {
    dsn?: string;
}

export const TelemetryConfig: Schema<TelemetryConfig> = Schema.object({
    enabled: Schema.boolean().default(true).description("是否启用遥测功能。"),
    dsn: Schema.string().role("link").default("https://e3d12be336e64e019c08cd7bd17985f2@sentry.nekohouse.cafe/1"),
    enableLogs: Schema.boolean().default(false).description("是否在控制台打印日志。"),
    debug: Schema.boolean().default(false).description("是否启用调试模式。"),
});
