import type { Session } from "koishi";

// region data models

/**
 * 事件类型枚举
 */
export enum TimelineEventType {
    Message = "message", // 普通消息 (文本/富文本)
    Command = "command", // 指令调用 (用户显式触发指令)

    MemberJoin = "notice.member.join", // 成员加入
    MemberLeave = "notice.member.leave", // 成员离开
    StateUpdate = "notice.state.update", // 状态变更 (如群名修改、禁言)
    Reaction = "notice.reaction", // 表态/回应 (点赞等轻量交互)

    AgentThought = "agent.thought", // 思考链 (CoT)
    AgentTool = "agent.tool", // 工具调用记录
    AgentAction = "agent.action", // 智能体产生的非消息类行为 (如修改群名片)
}

/**
 * 事件线表基类
 */
export interface BaseTimelineEntry<Type extends TimelineEventType, Data extends Record<string, any>> {
    id: string;
    timestamp: Date;
    scopeId: string;

    eventType: Type;

    // 优先级：用于上下文截断时的保留权重
    // 0: 噪音 (可丢弃)
    // 1: 普通 (标准历史)
    // 2: 重要 (关键事实)
    // 3: 核心 (永久记忆/系统指令)
    priority: number;

    // 事件发起者 ID (User ID / Bot ID / System ID)
    actorId: string;

    // 直接嵌入事件数据 (JSON)
    eventData: Data;
}

// 消息事件
export interface MessageEventData {
    senderName: string;
    content: string;
    messageId: string; // 平台侧的消息ID
    replyTo?: string; // 引用回复
    elements?: any[]; // 结构化消息段 (Koishi Elements)
}

export type MessageRecord = BaseTimelineEntry<TimelineEventType.Message, MessageEventData>;

// 通知/状态事件
export interface NoticeEventData {
    subType: string; // 具体通知类型
    targetId?: string; // 被操作的目标 (如被踢出的成员)
    operatorId?: string; // 操作者 (如管理员)
    details: Record<string, any>; // 变更详情 (如 { oldName: "A", newName: "B" })
    displayText: string; // 用于构建 Prompt 的自然语言描述
}

export type NoticeRecord = BaseTimelineEntry<
    TimelineEventType.MemberJoin
    | TimelineEventType.MemberLeave
    | TimelineEventType.StateUpdate
    | TimelineEventType.Reaction,
    NoticeEventData
>;

// 智能体执行事件
export interface AgentActivityData {
    triggerId?: string; // 触发此行为的事件ID

    // 思考 (Thought)
    thoughtContent?: string;

    // 工具 (Tool)
    toolName?: string;
    toolArgs?: any;
    toolResult?: any;

    // 消耗统计
    tokenUsage?: {
        prompt: number;
        completion: number;
    };
}

export type AgentRecord = BaseTimelineEntry<
    TimelineEventType.AgentThought
    | TimelineEventType.AgentTool
    | TimelineEventType.AgentAction,
    AgentActivityData
>;

// 聚合类型
export type TimelineEntry = MessageRecord | NoticeRecord | AgentRecord;

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

// region specific concepts

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

// endregion

// region world state model

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

// region stimulus model

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
