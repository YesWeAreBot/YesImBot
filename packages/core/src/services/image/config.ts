import { Schema } from "koishi";

/** 图片服务配置 */
export interface ImageServiceConfig {
    /**
     * 图片存储路径
     * @description 用于存储从聊天中下载的图片
     */
    storagePath: string;
    /**
     * 是否启用自动清理
     * @description 启用后，服务会定期清理过期的图片缓存
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
     * 图片最大保留天数
     * @description 超过此天数未被使用的图片将被自动清理
     * @default 30
     */
    maxImageAgeDays: number;
}

export const ImageServiceConfigSchema: Schema<ImageServiceConfig> = Schema.object({
    storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/yesimbot/images")
        .description("图片本地存储路径"),

    autoClearEnabled: Schema.boolean()
        .default(true)
        .description("是否启用自动清理功能"),

    autoClearIntervalHours: Schema.number()
        .min(1)
        .default(24)
        .description("自动清理任务的执行周期（单位：小时）"),

    maxImageAgeDays: Schema.number()
        .min(1)
        .default(30)
        .description("图片最长保留天数（根据最后使用时间判断）"),
});