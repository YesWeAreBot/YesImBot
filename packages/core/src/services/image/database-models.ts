import { TableName } from "../types";

/**
 * 图片元数据在数据库中的结构
 */
export interface ImageData {
    /** 图像内容的 MD5 哈希，作为唯一 ID */
    id: string;
    /** 图像的 MIME 类型, e.g., 'image/png' */
    mimeType: string;
    /** 图像在本地的存储路径 */
    localPath: string;
    /** 图像的原始 URL */
    originalUrl: string;
    /** 文件大小 (bytes) */
    size: number;
    /** 图像首次被记录的时间 */
    createdAt: Date;
    /** 图像最后被使用的时间 */
    lastUsedAt?: Date;
    /** 图像的文本描述 (为第三阶段预留) */
    description?: string;
    /** 图像来源信息 */
    source: {
        platform: string;
        guildId?: string;
        channelId: string;
        userId: string;
        messageId: string;
    };
}



declare module "koishi" {
    interface Tables {
        [TableName.Images]: ImageData;
    }
}
