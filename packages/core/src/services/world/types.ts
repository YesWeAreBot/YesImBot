import type { Session } from "koishi";

// region 数据库模型

/**
 * 事件线表
 */
export interface BaseTimelineEntry<Type extends string, Category extends string, Data extends Record<string, any>> {
    id: string;
    timestamp: Date;
    scopeId: string;
    eventType: Type;
    eventCategory: Category;
    priority: number;

    // 直接嵌入事件数据 (JSON)
    eventData: Data;
}

export interface MessageEventData {
    id: string;
    // 消息特定字段
    senderId: string;
    senderName: string;
    content: string;

    // 可选字段
    replyTo?: string;
    isDeleted?: boolean;
}

export type MessageRecord = BaseTimelineEntry<"user_message", "message", MessageEventData>;

export interface SystemEventData {
    eventType: string;
    actorId?: string;
    targetId?: string;
    metadata: Record<string, any>;
    message?: string;
}

export type SystemEventRecord = BaseTimelineEntry<"system_event", "system", SystemEventData>;

export interface AgentResponseData {
    // Agent 响应特定字段
    triggerId: string; // 触发的 Timeline Entry ID (索引)
    actions: any[]; // 执行的动作
    thoughts?: string; // 思考过程
    toolCalls?: any[]; // 工具调用记录
}

export type AgentResponseRecord = BaseTimelineEntry<"agent_response", "agent", AgentResponseData>;

export type TimelineEntry = MessageRecord | SystemEventRecord | AgentResponseRecord;

/**
 * 成员数据 - 数据库表定义
 */
export interface MemberData {
    pid: string;
    platform: string;
    guildId: string;
    name: string;
    roles: string[];
    avatar?: string;
    joinedAt?: Date;
    lastActive?: Date;
}

// endregion

// region WorldState

/**
 * 智能体自身信息
 */
export interface SelfInfo {
    id: string;
    name: string;
    avatar?: string;
    platform?: string;
}

/**
 * L2 记忆单元（语义记忆）
 */
export interface Memory {
    id: string;
    type: "conversation" | "event" | "tool_call";

    content: {
        summary: string;
        rawMessages?: string[];
    };

    metadata: {
        createdAt: Date;
        lastAccessed: Date;
        accessCount: number;
        participants: string[];
        channels: string[];
        importance: number;
    };

    embedding?: number[];
}

/**
 * L3 日记条目（自我反思）
 */
export interface DiaryEntry {
    id: string;
    date: string; // YYYY-MM-DD

    reflection: {
        significantEvents: Array<{
            event: string;
            whySignificant: string;
        }>;

        learnings: Array<{
            insight: string;
            source: string;
        }>;

        stateChanges?: {
            moodShift?: string;
            relationshipUpdates?: Array<{
                person: string;
                change: string;
            }>;
        };
    };

    narrative?: string;
}

/**
 * 环境 - 智能体活动的空间
 */
export interface Environment {
    /** 环境类型 */
    type: string; // "chat_channel" | "game_room" | "home_zone" | "web_context"

    /** 环境唯一标识 */
    id: string;

    /** 环境名称 */
    name: string;

    /** 环境元数据 (场景特定) */
    metadata: Record<string, any>;
}

/**
 * 实体 - 环境中的参与者或对象
 */
export interface Entity {
    /** 实体类型 */
    type: string; // "user" | "npc" | "device" | "forum_user"

    /** 实体唯一标识 */
    id: string;

    /** 实体名称 */
    name: string;

    /** 实体属性 (场景特定) */
    attributes: Record<string, any>;
}

/**
 * 事件 - 环境中发生的事情
 */
export interface Event {
    /** 事件类型 */
    type: string; // "message" | "player_action" | "sensor_data" | "post"

    /** 事件时间戳 */
    timestamp: Date;

    /** 事件发起者 (可选) */
    actor?: Entity;

    /** 事件内容 (场景特定) */
    payload: Record<string, any>;
}

/**
 * 通用 WorldState 结构
 *
 * 描述了智能体所处的世界
 *
 * 所有场景都可以抽象为:
 * - **在哪里** (Environment): 智能体活动的空间
 * - **有谁/什么** (Entity): 环境中的参与者或对象
 * - **发生了什么** (Event): 环境中发生的事情
 */
export interface WorldState {
    /** 状态类型标识 */
    stateType: "scoped" | "global";

    /** 触发此状态的刺激 */
    trigger: {
        type: StimulusSource;
        timestamp: Date;
        description: string;
    };

    /** 智能体自身信息 */
    self: SelfInfo;

    /** 当前时间 */
    currentTime: Date;

    /** 环境信息 (仅 scoped 状态) */
    environment?: Environment;

    /** 实体列表 (仅 scoped 状态) */
    entities?: Entity[];

    /** 事件历史 (线性历史) */
    eventHistory?: Event[];

    /** 检索到的记忆 (语义记忆) */
    retrievedMemories?: Memory[];

    /** 反思日记 (自我认知) */
    diaryEntries?: DiaryEntry[];

    /** 场景特定的扩展数据 */
    extensions: Record<string, any>;
}

/**
 * 任意 WorldState 类型
 */
export type AnyWorldState = WorldState;

// endregion

// region Stimulus

export enum StimulusSource {
    UserMessage = "user_message",
}

export interface UserMessageStimulusPayload extends Session {}

export interface StimulusPayloadMap {
    [StimulusSource.UserMessage]: UserMessageStimulusPayload;
}

export interface Stimulus<T extends StimulusSource = StimulusSource> {
    type: T;
    priority: number;
    timestamp: Date;
    payload: StimulusPayloadMap[T];
}

export type UserMessageStimulus = Stimulus<StimulusSource.UserMessage>;

export type AnyStimulus = UserMessageStimulus;

// endregion

export function isScopedStimulus(stimulus: AnyStimulus): boolean {
    return stimulus.type === StimulusSource.UserMessage;
}
