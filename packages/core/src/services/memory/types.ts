export interface MemoryBlockData {
    title: string;
    label: string;
    description: string;
    content: string[];
}

/** 记忆服务操作结果 */
export interface MemoryOperationResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    metadata?: Record<string, any>;
}

/** 搜索选项 */
export interface SearchOptions {
    /** 相关实体ID列表 */
    entityIds?: string[];
    /** 返回结果数量限制 */
    limit?: number;
    /** 最小显著性阈值 */
    minSalience?: number;
    /** 最小相似度阈值 */
    minSimilarity?: number;
    /** 是否包含已删除的记录 */
    includeDeleted?: boolean;
}

/** 实体合并选项 */
export interface EntityMergeOptions {
    /** 相似度阈值，超过此值的实体将被视为重复 */
    similarityThreshold?: number;
    /** 是否自动合并 */
    autoMerge?: boolean;
    /** 合并策略 */
    mergeStrategy?: 'keep_oldest' | 'keep_newest' | 'merge_metadata';
}

/** 用户画像整合选项 */
export interface ProfileConsolidationOptions {
    /** 是否强制重新整合 */
    forceReconsolidate?: boolean;
    /** 最小事实数量阈值 */
    minFactsThreshold?: number;
    /** 置信度阈值 */
    confidenceThreshold?: number;
}

/** 实体类型枚举 */
export enum EntityType {
    Person = "person",
    Project = "project",
    Group = "group",
    Event = "event",
    Topic = "topic",
    Organization = "organization",
    Unknown = "unknown",
}

/**
 * 实体 (Entity)
 * 描述世界中的任何一个独立概念，是所有记忆的基础。
 */
export interface Entity {
    id: string; // 唯一ID (e.g., CUID)
    type: EntityType;
    name: string;
    /** 实体的额外元数据，如用户ID、平台信息等 */
    metadata?: Record<string, any>; // e.g., { userId: 'U12345', platform: 'discord' }
    /** 实体的向量嵌入，用于相似度计算 */
    embedding?: number[];
    /** 创建时间 */
    createdAt: Date;
    /** 最后更新时间 */
    updatedAt?: Date;
    /** 是否已删除（软删除） */
    isDeleted?: boolean;
}

/** 事实类型枚举 */
export enum FactType {
    Observation = "observation", // 对事件或状态的观察
    Statement = "statement", // 用户直接陈述的观点或信息
    Interaction = "interaction", // 描述一次互动
    Preference = "preference", // 用户的偏好
}

/**
 * 记忆事实 (Fact)
 * 记录客观发生的事情或陈述，关联一个或多个实体。
 */
export interface Fact {
    id: string; // 唯一ID (e.g., CUID)
    content: string;
    embedding: number[];
    relatedEntityIds: string[];
    type: FactType | string; // 支持扩展类型
    sourceMessageId?: string;
    salience: number; // 显著性/重要性 (0-1)
    createdAt: Date;
    lastAccessedAt: Date;
    accessCount: number;
    /** 事实的置信度 (0-1) */
    confidence?: number;
    /** 是否已删除（软删除） */
    isDeleted?: boolean;
    /** 最后更新时间 */
    updatedAt?: Date;
}

/**
 * 人物画像 (UserProfile)
 * 对'person'类型实体的深度、动态总结。
 */
export interface UserProfile {
    id: string; // 唯一ID (e.g., CUID)
    entityId: string; // 关联到 Entity 表中 type='person' 的实体ID
    content: string; // AI生成的关于此人的高阶摘要
    embedding: number[];
    confidence: number; // 画像置信度 (0-1)
    supportingFactIds: string[]; // 支撑这条画像的核心事实ID列表
    updatedAt: Date;
    /** 创建时间 */
    createdAt?: Date;
    /** 画像版本号，用于跟踪更新 */
    version?: number;
    /** 是否已删除（软删除） */
    isDeleted?: boolean;
    /** 画像标签，用于分类 */
    tags?: string[];
}

/** LLM提炼后输出的结构化事实 */
export interface ExtractedFact {
    content: string;
    relatedEntities: {
        name: string;
        type: EntityType;
    }[];
    type: FactType;
    salience: number; // 0-1
    sourceMessageId: string;
}

export interface ExtractedInsight {
    content: string;
    relatedEntities: { name: string; type: string; metadata?: any }[];
    type: "behavioral_pattern";
    salience: number;
    sourceMessageId: string;
}

export interface ConversationChunk {
    messages: {
        id: string;
        author: { id: string; name: string };
        text: string;
        timestamp: Date;
    }[];
}