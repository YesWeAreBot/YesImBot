/**
 * 资源类型枚举
 */
export enum AssetType {
    Image = "image",
    Audio = "audio",
    Video = "video",
    File = "file",
    Unknown = "unknown",
}

/**
 * 数据库中存储的资源元数据模型
 */
export interface AssetData {
    id: string; // 主键，唯一的内部资源 ID (UUID)
    type: string; // 资源类型 (AssetType)
    mime: string; // 资源的 MIME 类型
    hash: string; // 文件内容的 SHA256 哈希，用于去重
    size: number; // 文件大小（字节）
    createdAt: Date; // 创建时间
    lastUsedAt: Date; // 最后使用时间
    metadata?: any; // 可选的元数据，如图片宽高、视频时长、原始的外部 URL、原始文件名等
}

/**
 * 资源创建选项
 */
export interface AssetCreateOptions {
    type?: AssetType; // 预指定的资源类型
    filename?: string; // 预指定的文件名
}

/**
 * 对外暴露的资源信息
 */
export interface AssetInfo extends Omit<AssetData, "hash" | "url"> {}

/**
 * 存储驱动接口
 */
export interface StorageDriver {
    write(id: string, buffer: Buffer): Promise<void>;
    read(id: string): Promise<Buffer>;
    delete(id: string): Promise<void>;
}
