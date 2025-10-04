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

export interface MessageData {
    id: string;
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

export interface SystemEventData {
    id: string;
    platform: string;
    channelId: string;
    type: string;
    timestamp: Date;
    payload: object;
    message?: string;
}

export interface AgentResponse {
    thoughts: { observe: string; analyze_infer: string; plan: string };
    actions: { function: string; params: Record<string, unknown> }[];
    observations?: { function: string; status: "success" | "failed" | string; result?: any; error?: any }[];
    request_heartbeat: boolean;
}

export interface AgentThoughtLog {
    type: "agent_thought";
    id: string;
    turnId: string;
    timestamp: string;
    thoughts: { observe: string; analyze_infer: string; plan: string };
}

export interface AgentActionLog {
    type: "agent_action";
    id: string;
    turnId: string;
    timestamp: string;
    function: string;
    params: Record<string, unknown>;
}

export interface AgentObservationLog {
    type: "agent_observation";
    id: string;
    turnId: string;
    actionId: string;
    timestamp: string;
    function: string;
    status: "success" | "failed" | string;
    result?: any;
    error?: any;
}

export interface AgentHeartbeatLog {
    type: "agent_heartbeat";
    id: string;
    turnId: string;
    timestamp: string;
    current: number;
    max: number;
}

export type AgentLogEntry = AgentThoughtLog | AgentActionLog | AgentObservationLog | AgentHeartbeatLog;

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

export interface DiaryEntryData {
    id: string;
    date: string; // 'YYYY-MM-DD'
    platform: string;
    channelId: string;
    content: string; // 第一人称日记
    keywords: string[]; // 当天发生的关键事件或提及的关键词，用于快速过滤
    mentionedUserIds: string[]; // 当天交互过的主要人物
}

/** 上下文中的消息对象 */
export interface ContextualMessage {
    id: string;
    sender: { id: string; name?: string; roles?: string[] };
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

/** 上下文中的 Agent 思考对象 */
export interface ContextualAgentThought {
    type: "agent_thought";
    turnId: string;
    timestamp: Date;
    observe: string;
    analyze_infer: string;
    plan: string;
    is_new?: boolean;
}

/** 上下文中的 Agent 动作对象 */
export interface ContextualAgentAction {
    type: "agent_action";
    turnId: string;
    timestamp: Date;
    function: string;
    params: Record<string, unknown>;
    is_new?: boolean;
}

/** 上下文中的 Agent 观察对象 */
export interface ContextualAgentObservation {
    type: "agent_observation";
    turnId: string;
    timestamp: Date;
    function: string;
    status: "success" | "failed" | string;
    result?: any;
    is_new?: boolean;
}

export interface ContextualAgentHeartbeat {
    type: "agent_heartbeat";
    turnId: string;
    timestamp: Date;
    current: number;
    max: number;
    is_new?: boolean;
}

/** L1 工作记忆中的单个事件条目 */
export type L1HistoryItem =
    | ({ type: "message" } & ContextualMessage)
    | ContextualAgentThought
    | ContextualAgentAction
    | ContextualAgentObservation
    | ContextualAgentHeartbeat
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
    working_memory: {
        processed_events: L1HistoryItem[];
        new_events: L1HistoryItem[];
    };
    /** L2: 从海量历史中检索到的相关记忆片段 */
    retrieved_memories?: RetrievedMemoryChunk[];
    /** L3: 相关的历史日记条目 */
    diary_entries?: DiaryEntryData[];
    // 其他动态信息，如用户画像等
    users?: {
        id: string;
        name: string;
        roles?: string[];
        description: string;
    }[];
}

export enum StimulusSource {
    UserMessage = "user_message",
    SystemEvent = "system_event",
    ScheduledTask = "scheduled_task",
    BackgroundTaskCompletion = "background_task_completion",
}

export interface UserMessagePayload {
    platform: string;
    channelId: string;
    session: Session;
}

export interface SystemEventPayload {
    eventType: string;
    details: object;
    message: string;
    session: Session;
}

/**
 * 计划任务或主动消息
 */
export interface ScheduledTaskPayload {
    taskId: string;
    taskType: string;
    platform: string;
    channelId: string;
    params?: Record<string, unknown>;
    scheduledTime: Date;
}

/**
 * 后台任务完成通知
 */
export interface BackgroundTaskCompletionPayload {
    taskId: string;
    taskType: string;
    platform: string;
    channelId: string;
    result: any;
    error?: string;
    completedAt: Date;
}

export interface StimulusPayloadMap {
    [StimulusSource.UserMessage]: UserMessagePayload;
    [StimulusSource.SystemEvent]: SystemEventPayload;
    [StimulusSource.ScheduledTask]: ScheduledTaskPayload;
    [StimulusSource.BackgroundTaskCompletion]: BackgroundTaskCompletionPayload;
}

export interface AgentStimulus<T extends StimulusSource = StimulusSource> {
    type: T;
    priority: number;
    timestamp: Date;
    payload: StimulusPayloadMap[T];
}

export type UserMessageStimulus = AgentStimulus<StimulusSource.UserMessage>;
export type SystemEventStimulus = AgentStimulus<StimulusSource.SystemEvent>;
export type ScheduledTaskStimulus = AgentStimulus<StimulusSource.ScheduledTask>;
export type BackgroundTaskCompletionStimulus = AgentStimulus<StimulusSource.BackgroundTaskCompletion>;

export type AnyAgentStimulus = UserMessageStimulus | SystemEventStimulus | ScheduledTaskStimulus | BackgroundTaskCompletionStimulus;

declare module "koishi" {
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Messages]: MessageData;
        [TableName.SystemEvents]: SystemEventData;
        [TableName.L2Chunks]: MemoryChunkData;
        [TableName.L3Diaries]: DiaryEntryData;
    }
}
