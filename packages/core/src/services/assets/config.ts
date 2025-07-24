import { Schema } from "koishi";

export interface AssetServiceConfig {
    storagePath: string;
    driver: "local";
    autoClearEnabled: boolean;
    autoClearIntervalHours: number;
    maxAssetAgeDays: number;
    endpoint?: string;
    maxFileSize: number;
    supportedMimeTypes: string[];
    imageProcessing: {
        enabled: boolean;
        quality: number;
        maxLongSide: number;
        minShortSide: number;
    };
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

    supportedMimeTypes: Schema.array(Schema.string())
        .default([
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "audio/mpeg", "audio/wav", "audio/ogg",
            "video/mp4", "video/mpeg", "video/webm",
            "application/pdf", "text/plain", "text/markdown",
            "application/zip", "application/x-zip-compressed"
        ])
        .description("支持的 MIME 类型列表。只有这些类型的文件才会被处理。"),

    imageProcessing: Schema.object({
        enabled: Schema.boolean().default(true).description("是否启用图片处理和优化。"),
        quality: Schema.number().min(1).max(100).default(85).description("JPEG 压缩质量（1-100）。"),
        maxLongSide: Schema.number().min(100).default(2048).description("图片长边的最大像素数。"),
        minShortSide: Schema.number().min(50).default(512).description("图片短边的最小像素数。"),
    }).description("图片处理配置。"),
});
