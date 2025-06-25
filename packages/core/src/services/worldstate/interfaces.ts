import { Channel as KChannel } from "koishi";

/**
 * 本文件定义了 WorldState 服务的核心领域对象。
 * 这些接口代表了业务逻辑操作的核心，由仓储层(Repository)负责从数据库数据(DTOs)构建。
 */

import { AgentTurnData, DialogueSegmentData } from "./model";

// --- 基础实体 (Entities) ---

/**
 * 代表一个平台用户，包含了从平台API实时获取或缓存的基础信息。
 */
export interface PlatformUser {
    /** 平台唯一用户ID (pid) */
    id: string;
    /** 用户在平台上的全局名称或用户名 */
    name?: string;
    /** 用户在平台上的头像URL */
    avatar?: string;
    /** 是否为机器人 */
    isBot?: boolean;
}

/**
 * 代表一个在特定频道中的成员，是最终呈现给 Agent 的核心用户对象。
 * 它是通过融合【平台实时信息】和【我们数据库中的附加状态】而成的完整视图。
 */
export interface Member extends PlatformUser {
    /** 在特定频道中的昵称 (优先使用我们DB的覆盖值，否则使用平台值) */
    nick?: string;
    /** 在特定频道中的角色 (优先使用我们DB的覆盖值，否则使用平台值) */
    role?: string;
}

/**
 * 频道内成员的宏观统计信息。
 */
export interface MemberSummary {
    totalCount: number;
    onlineCount: number;
    recentActiveCount: number;
}

// --- 核心结构 (Core Structures) ---

/**
 * 代表 Agent 感知到的整个世界快照。
 */
export interface WorldState {
    timestamp: string;
    activeChannels: Channel[];
    inactiveChannels: Channel[];
}

/** 新增：代表一个用户主导的连续对话片段 */
export interface DialogueSegment {
    id: string;
    /** 新增：所属的平台 */
    platform: string;
    /** 新增：所属的频道ID */
    channelId: string;
    status: DialogueSegmentData["status"];
    events: Event[];
    summary?: string;
    startTimestamp: Date;
    endTimestamp: Date;
    // 添加 is_dialogue_segment 方便模板渲染
    is_dialogue_segment: true;
    is_agent_turn: false;
}

/** 重命名：代表一次 Agent 主导的完整 ReAct 循环 */
export interface AgentTurn {
    id: string;
    /** 新增：所属的平台 */
    platform: string;
    /** 新增：所属的频道ID */
    channelId: string;
    stimulusSegmentId: string;
    status: AgentTurnData["status"];
    responses: AgentResponse[];
    startTimestamp: Date;
    endTimestamp: Date;
    // 添加 is_agent_turn 方便模板渲染
    is_agent_turn: true;
    is_dialogue_segment: false;
}

export interface Channel extends KChannel {
    name: string;
    type: "group" | "private";
    description?: string;
    members: Member[];
    memberSummary: MemberSummary;
    /** 修改：历史记录现在是两种类型对象的混合数组 */
    history: (DialogueSegment | AgentTurn)[];
}

// --- 事件系统 (Event System) ---

/**
 * 所有事件的基类。
 * @template T - 事件类型的字符串字面量。
 * @template P - 事件特有的数据负载 (payload)。
 */
export interface BaseEvent<T extends string, P extends object> {
    id: string;
    type: T;
    timestamp: Date;
    /** 负载对象，包含了事件的核心信息和关联ID */
    payload: P;
    /** 一个方便模板渲染的布尔标记 */
    [key: `is_${string}`]: boolean;
}

export type MessageEvent = BaseEvent<
    "message",
    {
        actor: Member; // 统一使用 actor
        content: string;
        messageId: string;
        quote?: { messageId: string; content?: string; actor: Member };
    }
>;

export type MemberJoinedEvent = BaseEvent<
    "member-joined",
    {
        actor: Member; // 操作者
        user: Member; // 加入的成员
    }
>;

export type MemberLeftEvent = BaseEvent<
    "member-left",
    {
        actor: Member; // 操作者
        user: Member; // 离开的成员
    }
>;

/**
 * 通用事件，用于捕获所有未被强类型定义的其他事件。
 */
export type GenericEvent = BaseEvent<
    string,
    {
        koishiEventName: string;
        actor?: Member;
        [key: string]: any;
    }
>;

export type Event = MessageEvent | MemberJoinedEvent | MemberLeftEvent | GenericEvent;

// --- Agent 响应结构 ---
export interface AgentResponse {
    thoughts: { observe: string; analyze_infer: string; plan: string };
    actions: Action[];
    observations: ActionResult[];
    request_heartbeat: boolean;
}

export interface Action {
    function: string;
    params: Record<string, unknown>;
}

export interface ActionResult {
    function: string;
    result: any;
}