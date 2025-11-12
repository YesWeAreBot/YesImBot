import type { Element, Session } from "koishi";

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

export interface MessagePayload {
    id: string;
    sender: {
        id: string;
        name?: string;
        roles?: string[];
    };
    content: string;
    quoteId?: string;
}

export interface ChannelEventPayloadData {
    eventType: ChannelEventType;
    message: string;
    details: object;
}

export interface GlobalEventPayloadData {
    eventType: keyof typeof GlobalEventType;
    eventName: string;
    details: object;
}

/**
 * Agent 响应负载数据
 * 记录智能体的工具调用和动作执行结果
 */
export interface AgentResponsePayload {
    /** 工具调用记录（信息获取类操作） */
    toolCalls?: Array<{
        id: string;
        function: string;
        params: Record<string, any>;
        result?: {
            success: boolean;
            data?: any;
            error?: string;
        };
    }>;

    /** 动作记录（与用户交互的操作） */
    actions: Array<{
        id: string;
        function: string; // "send_message", "send_sticker" 等
        params: Record<string, any>;
        result?: {
            success: boolean;
            data?: any;
            error?: string;
        };
    }>;

    /** 元数据 */
    metadata?: {
        turnId?: string;
        heartbeatCount?: number;
    };
}

export interface EventData {
    id: string;
    type: "message" | "channel_event" | "global_event" | "agent_response";
    timestamp: Date;
    platform?: string; // 全局事件可能没有 platform
    channelId?: string; // 全局事件没有 channelId
    payload: MessagePayload | ChannelEventPayloadData | GlobalEventPayloadData | AgentResponsePayload;
}

export interface MessageData extends EventData {
    type: "message";
    payload: MessagePayload;
}

export interface AgentResponseData extends EventData {
    type: "agent_response";
    payload: AgentResponsePayload;
}

export enum StimulusSource {
    UserMessage = "user_message",
    ChannelEvent = "channel_event",
    GlobalEvent = "global_event",
    ScheduledTask = "scheduled_task",
    BackgroundTaskCompletion = "background_task_completion",
    SelfInitiated = "self_initiated",
}

/**
 * Stimulus 的高层分类
 * 用于工具的 Activator 过滤和上下文构建策略
 */
export enum StimulusCategory {
    /** 用户交互类 - 用户发送的消息 */
    UserInteraction = "user_interaction",
    /** 频道事件类 - 群组内发生的事件（加入、离开、戳一戳等） */
    ChannelEvent = "channel_event",
    /** 系统事件类 - 全局系统事件（节假日、重大新闻等） */
    SystemEvent = "system_event",
    /** 定时任务类 - 预定的定时任务 */
    ScheduledTask = "scheduled_task",
    /** 任务完成类 - 后台任务完成的通知 */
    TaskCompletion = "task_completion",
    /** 自主发起类 - 智能体自主发起的行为 */
    SelfInitiated = "self_initiated",
}

/**
 * StimulusSource 到 StimulusCategory 的映射
 */
export const STIMULUS_CATEGORY_MAP: Record<StimulusSource, StimulusCategory> = {
    [StimulusSource.UserMessage]: StimulusCategory.UserInteraction,
    [StimulusSource.ChannelEvent]: StimulusCategory.ChannelEvent,
    [StimulusSource.GlobalEvent]: StimulusCategory.SystemEvent,
    [StimulusSource.ScheduledTask]: StimulusCategory.ScheduledTask,
    [StimulusSource.BackgroundTaskCompletion]: StimulusCategory.TaskCompletion,
    [StimulusSource.SelfInitiated]: StimulusCategory.SelfInitiated,
};

export interface UserMessageStimulusPayload extends Session {}

export interface ChannelEventStimulusPayload extends ChannelEventPayloadData {
    platform: string;
    channelId: string;
}

export type GlobalEventStimulusPayload = GlobalEventPayloadData;

export interface ScheduledTaskPayload {
    taskId: string;
    taskType: string;
    platform?: string;
    channelId?: string;
    params?: Record<string, unknown>;
    message?: string;
}

export interface BackgroundTaskCompletionPayload {
    taskId: string;
    taskType: string;
    platform?: string;
    channelId?: string;
    result: any;
    error?: any;
}

export interface SelfInitiatedPayload {
    reason: SelfInitiatedReason;
}

export interface StimulusPayloadMap {
    [StimulusSource.UserMessage]: UserMessageStimulusPayload;
    [StimulusSource.ChannelEvent]: ChannelEventStimulusPayload;
    [StimulusSource.GlobalEvent]: GlobalEventStimulusPayload;
    [StimulusSource.ScheduledTask]: ScheduledTaskPayload;
    [StimulusSource.BackgroundTaskCompletion]: BackgroundTaskCompletionPayload;
    [StimulusSource.SelfInitiated]: SelfInitiatedPayload;
}

export interface AgentStimulus<T extends StimulusSource = StimulusSource> {
    type: T;
    priority: number;
    timestamp: Date;
    payload: StimulusPayloadMap[T];
}

export type UserMessageStimulus = AgentStimulus<StimulusSource.UserMessage>;
export type ChannelEventStimulus = AgentStimulus<StimulusSource.ChannelEvent>;
export type GlobalEventStimulus = AgentStimulus<StimulusSource.GlobalEvent>;
export type ScheduledTaskStimulus = AgentStimulus<StimulusSource.ScheduledTask>;
export type BackgroundTaskCompletionStimulus = AgentStimulus<StimulusSource.BackgroundTaskCompletion>;
export type SelfInitiatedStimulus = AgentStimulus<StimulusSource.SelfInitiated>;

export type AnyAgentStimulus
    = | UserMessageStimulus
        | ChannelEventStimulus
        | GlobalEventStimulus
        | ScheduledTaskStimulus
        | BackgroundTaskCompletionStimulus
        | SelfInitiatedStimulus;

export type ChannelBoundStimulus = UserMessageStimulus | ChannelEventStimulus | ScheduledTaskStimulus | BackgroundTaskCompletionStimulus;
export type GlobalStimulus = GlobalEventStimulus | SelfInitiatedStimulus | ScheduledTaskStimulus | BackgroundTaskCompletionStimulus;

export interface ContextualMessage extends Pick<EventData, "id" | "timestamp">, MessagePayload {
    type: "message";
    is_new?: boolean;
    elements: Element[];
}

export interface ContextualChannelEvent extends Pick<EventData, "id" | "timestamp">, ChannelEventPayloadData {
    type: "channel_event";
    is_new?: boolean;
}

/**
 * Agent 响应记录（用于 L1 历史）
 * 记录智能体执行的工具调用和动作
 */
export interface ContextualAgentResponse extends Pick<EventData, "id" | "timestamp"> {
    type: "agent_response";

    /** 工具调用记录（信息获取类操作） */
    toolCalls?: Array<{
        id: string;
        function: string;
        params: Record<string, any>;
        result?: {
            success: boolean;
            data?: any;
            error?: string;
        };
    }>;

    /** 动作记录（与用户交互的操作） */
    actions: Array<{
        id: string;
        function: string;
        params: Record<string, any>;
        result?: {
            success: boolean;
            data?: any;
            error?: string;
        };
    }>;

    /** 元数据 */
    metadata?: {
        turnId?: string;
        heartbeatCount?: number;
    };

    is_new?: boolean;
}

export type L1HistoryItem = ContextualMessage | ContextualChannelEvent | ContextualAgentResponse;

interface BaseWorldState {
    contextType: "channel" | "global";
    triggerContext: object;
    self: { id: string; name: string };
    current_time: string; // ISO 8601
}

/** 用于频道交互的上下文 */
export interface ChannelWorldState extends BaseWorldState {
    contextType: "channel";
    channel: {
        id: string;
        name: string;
        type: "guild" | "private";
        platform: string;
    };
    users: {
        id: string;
        name: string;
        roles?: string[];
        description: string;
    }[];
    history: L1HistoryItem[];
}

/** 用于全局思考和规划的上下文 */
export interface GlobalWorldState extends BaseWorldState {
    contextType: "global";
    active_channels_summary?: {
        platform: string;
        channelId: string;
        name: string;
        last_activity: Date;
    }[];
}

export type AnyWorldState = ChannelWorldState | GlobalWorldState;

export const ChannelEventType = {
    Command: "command-invoked",
    Poke: "notice-poke",
    MemberJoined: "member-joined",
    MemberLeft: "member-left",
    BotMuted: "bot-muted",
    BotUnmuted: "bot-unmuted",
    ChannelTopicChanged: "channel-topic-changed",
};

export type ChannelEventType = (typeof ChannelEventType)[keyof typeof ChannelEventType];

export const GlobalEventType = {
    Holiday: "holiday",
    MajorNews: "major-news",
    SystemMaintenance: "system-maintenance",
};

export type GlobalEventType = (typeof GlobalEventType)[keyof typeof GlobalEventType];

export enum SelfInitiatedReason {
    IdleTrigger = "idle-trigger",
    PeriodicReflection = "periodic-reflection",
    MemoryConsolidation = "memory-consolidation",
}
