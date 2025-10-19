import { TableName } from "@/shared/constants";
import { Element, Session } from "koishi";

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

export interface EventData {
    id: string;
    type: "message" | "channel_event" | "global_event";
    timestamp: Date;
    platform?: string; // 全局事件可能没有 platform
    channelId?: string; // 全局事件没有 channelId
    payload: MessagePayload | ChannelEventPayloadData | GlobalEventPayloadData;
}

export enum StimulusSource {
    UserMessage = "user_message",
    ChannelEvent = "channel_event",
    GlobalEvent = "global_event",
    ScheduledTask = "scheduled_task",
    BackgroundTaskCompletion = "background_task_completion",
    SelfInitiated = "self_initiated",
}

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

export type AnyAgentStimulus =
    | UserMessageStimulus
    | ChannelEventStimulus
    | GlobalEventStimulus
    | ScheduledTaskStimulus
    | BackgroundTaskCompletionStimulus
    | SelfInitiatedStimulus;

export interface ContextualMessage extends Pick<EventData, "id" | "timestamp">, MessagePayload {
    type: "message";
    is_new?: boolean;
    elements: Element[]; // 在业务逻辑中从 `content` 解析得来
}

export interface ContextualChannelEvent extends Pick<EventData, "id" | "timestamp">, ChannelEventPayloadData {
    type: "channel_event";
    is_new?: boolean;
}

export type L1HistoryItem = ContextualMessage | ContextualChannelEvent;

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
    l1_working_memory: {
        processed_events: L1HistoryItem[];
        new_events: L1HistoryItem[];
    };
    users: {
        id: string;
        name: string;
        roles?: string[];
        description: string;
    }[];
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
