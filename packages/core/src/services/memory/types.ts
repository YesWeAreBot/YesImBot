export interface MemoryBlockData {
    title: string;
    label: string;
    description: string;
    limit: number;
    content: string[];
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
    metadata?: Record<string, any>; // e.g., { imUserId: 'U12345' }
    createdAt: Date;
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
    type: FactType;
    sourceMessageId?: string;
    salience: number; // 显著性/重要性 (0-1)
    createdAt: Date;
    lastAccessedAt: Date;
    accessCount: number;
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
}

/** 用户消息批处理单元 */
export interface UserMessageBatch {
    userId: string;
    userName: string;
    messages: { id: string; text: string; timestamp: number }[];
    lastMessageTimestamp: number;
}
