import { Schema } from "koishi";

export interface AssetServiceConfig {
    storagePath: string;
    driver: "local";
    autoClearEnabled: boolean;
    autoClearIntervalHours: number;
    maxAssetAgeDays: number;
    endpoint?: string;
    maxFileSize: number;
    downloadTimeout: number;
}

export const AssetServiceConfig: Schema<AssetServiceConfig> = Schema.object({
    storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/assets")
        .description("资源本地存储路径。"),

    driver: Schema.union(["local"]).default("local").description("存储驱动类型。目前仅支持本地存储。"),

    autoClearEnabled: Schema.boolean().default(true).description("是否启用自动清理过期资源的功能。"),

    autoClearIntervalHours: Schema.number().min(1).default(24).description("自动清理任务的执行周期（单位：小时）。"),

    maxAssetAgeDays: Schema.number().min(1).default(30).description("资源最长保留天数（根据最后使用时间判断）。"),

    endpoint: Schema.string()
        .role("link")
        .description("公开访问端点 URL (可选)。配置后，资源将通过此 URL 对外提供，例如 `https://mybot.com/assets`。"),

    maxFileSize: Schema.number()
        .min(1024)
        .default(100 * 1024 * 1024) // 100MB
        .description("允许存储的单个文件的最大大小（单位：字节）。"),

    downloadTimeout: Schema.number()
        .min(1000)
        .default(30000) // 30秒
        .description("下载资源的超时时间（单位：毫秒）。"),
});
