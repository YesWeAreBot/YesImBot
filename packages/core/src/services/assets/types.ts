import { Session } from "koishi";

/**
 * 资源类型枚举
 */
export enum AssetType {
    Image = "image",
    Audio = "audio", 
    Video = "video",
    File = "file"
}

/**
 * 数据库中存储的资源元数据模型
 */
export interface AssetData {
    /** 主键，唯一的内部资源 ID (UUID) */
    id: string;
    /** 资源类型，如 image, audio, video, file */
    type: string;
    /** 资源的 MIME 类型，如 image/png, application/pdf */
    mime: string;
    /** 文件内容的 SHA256 哈希，用于去重 */
    hash: string;
    /** 文件大小（字节） */
    size: number;
    /** 原始的外部 URL (可选，用于溯源) */
    url?: string;
    /** 原始文件名 (可选，用于<file>元素) */
    filename?: string;
    /** 创建时间 */
    createdAt: Date;
    /** 最后使用时间（每次发送或访问时更新） */
    lastUsedAt: Date;
    /** 原始消息来源信息 */
    source?: {
        platform: string;
        guildId?: string;
        channelId: string;
        userId: string;
        messageId: string;
    };
}

/**
 * 存储驱动接口
 */
export interface StorageDriver {
    /** 写入资源到存储系统 */
    write(id: string, buffer: Buffer): Promise<void>;
    /** 从存储系统读取资源 */
    read(id: string): Promise<Buffer>;
    /** 从存储系统删除资源 */
    delete(id: string): Promise<void>;
}

/**
 * 资源创建选项
 */
export interface AssetCreateOptions {
    /** 指定文件名 */
    filename?: string;
    /** 会话信息，用于记录来源 */
    session?: Session;
}

/**
 * 资源信息响应
 */
export interface AssetInfo {
    id: string;
    type: string;
    mime: string;
    size: number;
    filename?: string;
    createdAt: Date;
    lastUsedAt: Date;
}

/**
 * 文件内容分析结果
 */
export interface FileAnalysisResult {
    /** 文件类型 */
    type: AssetType;
    /** 文件内容摘要或描述 */
    content: string;
    /** 是否成功分析 */
    success: boolean;
    /** 错误信息（如果分析失败） */
    error?: string;
}
