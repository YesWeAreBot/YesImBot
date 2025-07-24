import { Schema } from "koishi";

/** 资源服务配置 */
export interface AssetServiceConfig {
    /**
     * 资源存储路径
     * @description 用于存储从聊天中下载的资源文件
     */
    storagePath: string;

    /**
     * 存储驱动类型
     * @description 选择资源存储的驱动类型
     * @default "local"
     */
    driver: "local";

    /**
     * 是否启用自动清理
     * @description 启用后，服务会定期清理过期的资源缓存
     * @default true
     */
    autoClearEnabled: boolean;

    /**
     * 自动清理周期（小时）
     * @description 每隔多少小时执行一次清理任务
     * @default 24
     */
    autoClearIntervalHours: number;

    /**
     * 资源最大保留天数
     * @description 超过此天数未被使用的资源将被自动清理
     * @default 30
     */
    maxAssetAgeDays: number;

    /**
     * 公开访问端点
     * @description 用于生成可公开访问的资源URL
     */
    endpoint?: string;

    /**
     * 最大文件大小（字节）
     * @description 单个资源文件的最大大小限制
     * @default 100MB
     */
    maxFileSize: number;

    /**
     * 支持的文件类型
     * @description 允许处理的MIME类型列表
     */
    supportedMimeTypes: string[];
}

export const AssetServiceConfigSchema: Schema<AssetServiceConfig> = Schema.object({
    storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/yesimbot/assets")
        .description("资源本地存储路径"),

    driver: Schema.union(["local"])
        .default("local")
        .description("存储驱动类型"),

    autoClearEnabled: Schema.boolean()
        .default(true)
        .description("是否启用自动清理功能"),

    autoClearIntervalHours: Schema.number()
        .min(1)
        .default(24)
        .description("自动清理任务的执行周期（单位：小时）"),

    maxAssetAgeDays: Schema.number()
        .min(1)
        .default(30)
        .description("资源最长保留天数（根据最后使用时间判断）"),

    endpoint: Schema.string()
        .description("公开访问端点URL（可选）"),

    maxFileSize: Schema.number()
        .min(1024)
        .default(100 * 1024 * 1024) // 100MB
        .description("单个文件最大大小（字节）"),

    supportedMimeTypes: Schema.array(String)
        .default([
            // 图片类型
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
            // 音频类型
            "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4",
            // 视频类型
            "video/mp4", "video/mpeg", "video/quicktime", "video/x-msvideo",
            // 文档类型
            "application/pdf", "text/plain", "text/markdown",
            "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            // 压缩文件
            "application/zip", "application/x-tar", "application/gzip",
            // JSON和其他文本
            "application/json", "text/html", "text/css", "text/javascript"
        ])
        .description("支持的MIME类型列表"),
});