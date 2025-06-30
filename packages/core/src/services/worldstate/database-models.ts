/**
 * @file database-models.ts
 * @description 定义插件的数据库模型 (DTOs) 和表结构。
 */
import { Action, ActionResult, AgentResponse } from "./agent-response-types";
import { EventName } from "./event-types";
import { AgentTurnStatus, DialogueSegmentStatus, Sender } from "./interfaces";

/**
 * 集中管理所有数据库表的名称，防止拼写错误并方便重构。
 */
export enum TableName {
    Members = "worldstate.members",
    DialogueSegments = "worldstate.dialogue_segments",
    AgentTurns = "worldstate.agent_turns",
    Messages = "worldstate.messages",
    SystemEvents = "worldstate.system_events",
    AgentResponses = "worldstate.agent_responses",
}

// --- 数据库表的数据传输对象 (DTOs) ---

/**
 * `worldstate.members` 表的数据结构。
 * 存储用户在一个特定服务器 (Guild) 内的身份信息。
 */
export interface MemberData {
    uid: number;
    pid: string;
    platform: string;
    guildId: string;

    name: string;
    username?: string;
    roles?: string[];
    avatar?: string;
    joinedAt?: Date;
    lastActive: Date;
}

/**
 * `worldstate.dialogue_segments` 表的数据结构。
 */
export interface DialogueSegmentData {
    id: string;
    platform: string;
    channelId: string;
    guildId?: string; // 新增字段
    status: DialogueSegmentStatus;
    summary?: string;
    timestamp: Date;
}

/**
 * `worldstate.agent_turns` 表的数据结构。
 */
export interface AgentTurnData {
    id: string;
    sid: string; // stimulusSegmentId
    platform: string;
    channelId: string;
    status: AgentTurnStatus;
    timestamp: Date;
}

/**
 * `worldstate.messages` 表的数据结构。
 */
export interface MessageData {
    id: string;
    platform: string; // 用于构成复合主键
    sid: string;
    channelId: string;
    sender: Sender;
    timestamp: Date;
    content: string; // 关键变更: 从 string(255) 变为 text
    quoteId?: string;
}

/**
 * `worldstate.system_events` 表的数据结构。
 */
export interface SystemEventData {
    id: string;
    sid: string;
    type: EventName;
    timestamp: Date;
    payload: object;
}

/**
 * `worldstate.agent_responses` 表的数据结构。
 */
export interface AgentResponseData {
    id: number;
    turnId: string;
    thoughts: AgentResponse["thoughts"];
    actions: Action[];
    observations: ActionResult[];
    request_heartbeat: boolean; // 新增字段
}

declare module "koishi" {
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.DialogueSegments]: DialogueSegmentData;
        [TableName.AgentTurns]: AgentTurnData;
        [TableName.Messages]: MessageData;
        [TableName.SystemEvents]: SystemEventData;
        [TableName.AgentResponses]: AgentResponseData;
    }
}
