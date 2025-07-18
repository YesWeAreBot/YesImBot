import { Schema } from "koishi";

/** 图片服务配置 */
export interface ImageServiceConfig {
    /**
     * 图片存储路径
     * @description 用于存储从聊天中下载的图片。
     */
    storagePath: string;
}

export const ImageServiceConfigSchema: Schema<ImageServiceConfig> = Schema.object({
    storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/yesimbot/images")
        .description("图片本地存储路径。"),
});