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
    /** 相关用户ID列表 */
    userIds?: string[];
    /** 返回结果数量限制 */
    limit?: number;
    /** 最小显著性阈值 */
    minSalience?: number;
    /** 最小相似度阈值 */
    minSimilarity?: number;
    /** 是否包含已删除的记录 */
    includeDeleted?: boolean;
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

/** 事实类型枚举 */
export enum FactType {
    Observation = "observation", // 对事件或状态的观察
    Interaction = "interaction", // 描述一次互动

    Statement = "statement", // 个人陈述：用户对自己或客观世界的直接陈述
    Opinion = "opinion", // 观点态度：用户对某事物表达的明确看法、评价或感受
    Preference = "preference", // 偏好喜好：关于个人喜好的陈述
    Plan = "plan", // 计划意图：用户声明的未来要做某事的计划
    Event = "event", // 重要事件：用户经历的或提及的具有标记意义的事件
}

/** 生命周期枚举 */
export enum LifespanType {
    Short = "short", // 短期时效性：通常是plan或event类型，在事件发生后可能失效
    Long = "long", // 长期有效性：通常是preference、opinion、statement类型，代表一个人的稳定特质
    Permanent = "permanent", // 永久性：几乎不会改变的核心事实，如职业、家乡、不可改变的经历等
}

/**
 * 记忆事实 (Fact)
 * 记录与特定用户相关的客观事实或陈述
 */
export interface Fact {
    id: string; // 唯一ID (e.g., CUID)
    userId: string; // 直接关联用户ID，移除实体抽象层
    userName: string; // 用户名称，便于查看和调试
    content: string; // 事实内容的第三人称简洁描述
    embedding: number[]; // 向量嵌入
    type: FactType; // 事实类型，严格按照枚举
    lifespan: LifespanType; // 生命周期
    sourceMessageIds: string[]; // 来源消息ID数组，支持多条消息构成一个事实
    salience?: number; // 显著性评分 (0-1)，代表此洞察的重要性

    createdAt: Date;
    lastAccessedAt: Date;
    accessCount: number;

    /** 是否已删除（软删除） */
    isDeleted?: boolean;
    /** 最后更新时间 */
    updatedAt?: Date;
}

/**
 * 记忆洞察 (Insight)
 * 记录从对话中提炼出的、关于群体动态或个人深层模式的更高层次判断
 */
export interface Insight {
    id: string; // 唯一ID (e.g., CUID)

    // 核心内容
    content: string; // 洞察内容的精炼描述
    embedding: number[]; // content的向量嵌入，用于相似性搜索
    type: InsightType; // 洞察类型，严格按照枚举

    // 关联与溯源
    relatedUserIds: string[]; // 该洞察所涉及的所有用户ID列表
    sourceMessageIds: string[]; // 支撑该洞察的关键来源消息ID数组

    // 元数据与生命周期管理
    lifespan: LifespanType; // 洞察通常是长期的
    createdAt: Date;
    updatedAt?: Date;
    lastAccessedAt: Date;
    accessCount: number;
    salience?: number; // 显著性评分 (0-1)，代表此洞察的重要性

    /** 是否已删除（软删除） */
    isDeleted?: boolean;
}

/**
 * 用户画像 (UserProfile)
 * 对特定用户的深度、动态总结
 */
export interface UserProfile {
    id: string; // 唯一ID (e.g., CUID)
    userId: string; // 直接关联用户ID
    userName: string; // 用户名称，便于查看和调试
    content: string; // AI生成的关于此人的高阶摘要
    embedding: number[];
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
    /** 关键事实用于下次增量更新 */
    keyFactsForUpdate?: string[];
    /** 显著性评分，用于搜索排序 */
    salience?: number;
    /** 画像置信度评分，用于判断画像的准确性和完整性 */
    confidence?: number;
}

/** LLM提炼后输出的结构化事实 */
export interface ExtractedFact {
    userId: string; // 事实归属的用户ID
    userName: string; // 事实归属的用户名
    type: FactType; // 事实类型，严格按照枚举
    content: string; // 对事实的第三人称简洁描述
    lifespan: LifespanType; // 事实的生命周期
    sourceMessageIds: string[]; // 来源消息ID数组
    salience?: number; // 显著性评分 (0-1)，代表此事实的重要性
}

/** 洞察类型枚举 */
export enum InsightType {
    BehavioralPattern = "behavioral_pattern", // 行为模式：通过用户在多条消息或多个回合中的行为总结出的模式
    RelationshipChange = "relationship_change", // 关系变化：用户之间的互动模式变化
    GroupConsensus = "group_consensus", // 群体共识：多个用户对某一话题达成的共同看法或兴趣点
}

/** LLM提炼后输出的结构化洞察 */
export interface ExtractedInsight {
    insightType: InsightType; // 洞察类型，严格按照枚举
    content: string; // 对洞察的精炼描述
    relatedUserIds: string[]; // 涉及的用户ID数组
    lifespan: LifespanType; // 洞察通常是长期的
    sourceMessageIds: string[]; // 关键来源消息ID数组
    salience?: number;
}

/** 对话块结构 - 用于事实提取的输入格式 */
export interface ConversationChunk {
    messages: {
        id: string;
        author: { id: string; name: string };
        text: string;
        timestamp: Date;
    }[];
}

/** LLM 事实提取的响应格式 */
export interface FactExtractionResponse {
    facts: ExtractedFact[];
    insights: ExtractedInsight[];
}