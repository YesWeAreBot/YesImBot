/**
 * @file types.ts
 * @description 定义基于多级缓存记忆模型的核心领域对象。
 *
 * 该模型将 Agent 的记忆分为三个层级：
 * - L1 (工作记忆): 包含最近的、完整的交互轮次，是 Agent 进行即时响应的基础。
 * - L2 (语义索引): 由从 L1 中移出的交互轮次转化而来的、经过向量化的记忆片段，用于相关性检索。
 * - L3 (长期存档): 以“日记”形式存在的、对每日交互的高度概括和总结，提供长周期的时间感和叙事记忆。
 */

import { TableName } from "@/shared/constants";
import { Element, Session } from "koishi";

// =================================================================================
// #region 核心数据模型 (对应数据库表结构)
// =================================================================================

/**
 * `worldstate.members` 表的数据结构
 * 存储用户在一个特定服务器 (Guild) 内的身份信息
 */
export interface MemberData {
    pid: string;
    platform: string;
    guildId: string;

    name: string;
    roles?: string[];
    avatar?: string;
    joinedAt?: Date;
    lastActive: Date;
}

/** 消息的数据模型 */
export interface MessageData {
    id: string; // 消息唯一ID
    platform: string;
    channelId: string;
    sender: {
        id: string;
        name?: string;
        roles?: string[];
    };
    timestamp: Date;
    content: string;
    quoteId?: string;
}

/** 系统事件的数据模型 */
export interface SystemEventData {
    id: string; // 事件唯一ID
    platform: string;
    channelId: string;
    type: string; // 例如 'guild-member-ban', 'command-invoked'
    timestamp: Date;
    payload: object; // 事件具体内容
    renderedMessage?: string; // 预渲染的自然语言消息
}

/** Agent 响应回合的数据模型，包含完整的思考链。 */
export interface AgentTurnData {
    id: string; // Agent回合的唯一ID
    platform: string;
    channelId: string;
    timestamp: Date;
    // 思考过程 (Thought): Agent 的内心独白
    thoughts: { observe: string; analyze_infer: string; plan: string };
    // 行动 (Action): Agent 决定执行的一个或多个具体动作
    actions: { function: string; params: Record<string, unknown> }[];
    // 观察 (Observation): 执行动作后从环境中获得的结果
    observations: { function: string; status: "success" | "failed" | string; result?: any; error?: any }[];
    request_heartbeat: boolean;
}

export type AgentResponse = Omit<AgentTurnData, "id" | "interactionId" | "timestamp">;

/** L2 记忆片段的数据模型，存储在向量数据库中。 */
export interface MemoryChunkData {
    id: string;
    platform: string;
    channelId: string;
    content: string;
    embedding: number[];
    participantIds: string[];
    startTimestamp: Date;
    endTimestamp: Date;
}

/** L3 日记条目的数据模型 */
export interface DiaryEntryData {
    id: string;
    date: string; // 'YYYY-MM-DD'
    platform: string;
    channelId: string;
    content: string; // 第一人称日记
    keywords: string[]; // 当天发生的关键事件或提及的关键词，用于快速过滤
    mentionedUserIds: string[]; // 当天交互过的主要人物
}
// #endregion

// =================================================================================
// #region 领域对象 (用于构建上下文和业务逻辑)
// =================================================================================

/** 上下文中的消息对象 */
export interface ContextualMessage {
    id: string;
    sender: { id: string; name?: string };
    content: string;
    elements: Element[];
    timestamp: Date;
    quoteId?: string;
    is_new?: boolean; // 是否是自上次 Agent 响应以来的新消息
}

/** 上下文中的系统事件对象 */
export interface ContextualSystemEvent {
    id: string;
    eventType: string;
    message: string; // 直接可读的事件描述
    timestamp: Date;
    is_new?: boolean; // 是否是自上次 Agent 响应以来的新事件
}

/** Agent 响应回合在上下文中的表现形式（支持优雅降级） */
export interface AgentTurnContext {
    timestamp: Date;
    is_new?: boolean; // 是否是自上次 Agent 响应以来的新事件
    /** 思考过程 (Thought): Agent 的内心独白。这是最有价值、保留最久的部分。 */
    thoughts?: { observe: string; analyze_infer: string; plan: string };
    /** 行动 (Action): Agent 决定执行的具体动作。 */
    actions?: { function: string; params: Record<string, unknown> }[];
    /** 观察 (Observation): 执行动作后获得的结果。这是最先被移除的部分。 */
    observations?: { function: string; status: "success" | "failed" | string; result?: any }[];
}

/** L1 工作记忆中的单个事件条目 */
export type L1HistoryItem =
    | ({ type: "message" } & ContextualMessage)
    | ({ type: "agent_turn" } & AgentTurnContext)
    | ({ type: "system_event" } & ContextualSystemEvent);

/** 从 L2 语义索引中检索出的记忆片段 */
export interface RetrievedMemoryChunk {
    content: string;
    relevance: number; // 相似度得分
    timestamp: Date;
}

/** Agent 感知到的世界状态快照，作为最终输入给 LLM 的上下文。 */
export interface WorldState {
    /** 触发本次心跳的直接原因 */
    triggerContext?: object;
    channel: {
        id: string;
        name: string;
        type: "guild" | "private";
        platform: string;
    };
    current_time: string;
    self: {
        id: string;
        name: string;
    };
    /** L1: 工作记忆，一个按时间顺序排列的线性事件流。 */
    l1_working_memory: L1HistoryItem[];
    /** L2: 从海量历史中检索到的相关记忆片段 */
    l2_retrieved_memories?: RetrievedMemoryChunk[];
    /** L3: 相关的历史日记条目 */
    l3_diary_entries?: DiaryEntryData[];
    // 其他动态信息，如用户画像等
    users?: {
        id: string;
        name: string;
        description: string;
    }[];
}

// #endregion

// =================================================================================
// #region Agent 刺激与响应
// =================================================================================

/** 智能体接收到的刺激类型 */
export type StimulusType = "user_message" | "system_event" | "scheduled_task" | "background_task_completion";

/** 用户消息刺激的载荷 */
export interface UserMessagePayload {
    messageIds: string[];
}

/** 系统事件刺激的载荷 */
export interface SystemEventPayload {
    eventType: string;
    details: object;
    message: string;
}

/** Agent 接收到的外部刺激，是驱动其行为的入口。 */
export interface AgentStimulus<T> {
    type: StimulusType;
    channelCid: string; // 'platform:channelId'
    session: Session;
    priority: number;
    payload: T;
}

// #endregion

declare module "koishi" {
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.AgentTurns]: AgentTurnData;
        [TableName.Messages]: MessageData;
        [TableName.SystemEvents]: SystemEventData;
        "worldstate.l2_chunks": MemoryChunkData;
        "worldstate.l3_diaries": DiaryEntryData;
    }
}
