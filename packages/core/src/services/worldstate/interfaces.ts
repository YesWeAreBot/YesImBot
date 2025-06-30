/**
 * @file domain-types.ts
 * @description 定义插件的核心领域对象 (Domain Objects)。
 *
 * 与 `database-models.ts` 中的数据传输对象 (DTOs) 不同，本文件中的接口代表了业务逻辑操作的核心。
 * 它们通常由仓储层 (Repository) 负责从数据库的 DTOs 构建，并可能包含业务方法或更丰富的结构。
 * 这些对象是 Agent 感知世界和进行决策的基础。
 */

import { Element, User } from "koishi";
import { SystemEvent } from "./event-types";
import { AgentResponse } from "./agent-response-types";

// --- 基础实体 (Entities) ---

/**
 * 代表一个群组或服务器中的成员，是用户在特定群组上下文中的表现。
 */
export interface GuildMember {
    /** 关联的 Koishi 内部用户 ID (uid) */
    uid: number;
    /** 关联的用户平台 ID (pid) */
    pid: string;
    /** 成员在群内的显示名称 (通常是昵称)。 */
    nick?: string;
    /** 成员的全局用户名。 */
    name?: string;
    /** 成员拥有的角色列表。 */
    roles?: string[];
    /** 加入群组的时间戳。 */
    joinedAt?: Date;
}

/**
 * 代表一个群组。
 */
export interface Guild {
    /** 平台提供的唯一群组ID。 */
    id: string;
    /** 群组名称。 */
    name?: string;
    /** 群组头像URL。 */
    avatar?: string;
}

/**
 * 代表一个通信频道，可以是群组中的一个子频道，也可以是私聊。
 */
export interface Channel {
    /** 频道ID。在私聊中，这通常是与对方用户的ID关联的标识。 */
    id: string;
    /** 频道名称。群聊时为群名，私聊时可格式化为 "与 <用户名> 的私聊"。 */
    name: string;
    /** 频道类型：'guild' (群组频道) 或 'private' (私聊)。 */
    type: "guild" | "private";
    /** 所属平台名称 (如 'onebot', 'discord')。 */
    platform: string;
    /** 扩展元信息。 */
    meta: {
        description?: string;
    };
    /** 最近活跃的成员列表。 */
    members?: GuildMember[];
    /**
     * 频道的历史记录流。
     * 这是一个包含用户主导的对话片段 (DialogueSegment) 和 Agent 完整回合 (AgentTurn) 的有序数组，
     * 共同构成了 Agent 感知到的频道交互全貌。
     */
    history: (DialogueSegment | AgentTurn)[];
}

/**
 * 发送者信息快照。
 * 记录了消息发送时刻用户的关键信息。
 */
export interface Sender {
    /** 用户的平台唯一ID (pid) */
    pid: string;
    /** 发送消息时用户的显示名称 (昵称) */
    name?: string;
    /** 发送消息时用户的角色 */
    roles?: string[];
}

/**
 * 代表在特定上下文中（如一个DialogueSegment里）的一条消息。
 */
export interface ContextualMessage {
    id: string;
    /** 消息内容 */
    content?: string;
    elements?: Element[];
    /** 消息发送的时间戳 */
    timestamp: Date;
    /** 引用另一条消息的ID */
    quoteId?: string;
    sender: Sender;
}

// --- 核心聚合根 (Aggregate Roots) ---

export type DialogueSegmentStatus = "open" | "closed" | "folded" | "summarized" | "archived";

/**
 * 用户对话片段，聚合了一段时间内的相关消息和系统事件。
 */
export interface DialogueSegment {
    type: "dialogue-segment"; // 类型守卫字段
    id: string;
    platform: string;
    channelId: string;
    guildId?: string;
    /**
     * 片段的生命周期状态。
     * - `open`: 开放中，正在接收新事件。
     * - `closed`: 已关闭，通常在 Agent 介入时发生，等待系统进一步处理。
     * - `folded`: 已折叠，其关联的 AgentTurn 因历史过长被从上下文中移除。
     * - `summarized`: 已总结，原始内容已被LLM压缩成摘要。
     * - `archived`: 已归档，记录在被物理删除前的最终状态，不参与上下文构建。
     */
    status: DialogueSegmentStatus;
    dialogue: ContextualMessage[];
    systemEvents: SystemEvent[];
    summary?: string;
    timestamp: Date;
}

export type AgentTurnStatus = "in_progress" | "completed";

/**
 * Agent 的一个完整处理回合，通常对应一次 ReAct 循环。
 */
export interface AgentTurn {
    type: "agent-turn"; // 类型守卫字段
    id: string;
    platform: string;
    channelId: string;
    /** 触发此 Agent 回合的对话片段ID。 */
    stimulusSegmentId: string;
    /**
     * Agent 回合的生命周期状态。
     * - `in_progress`: Agent 正在处理中。
     * - `completed`: Agent 处理完成。
     */
    status: AgentTurnStatus;
    /** 此回合中发生的所有响应步骤（思考->行动->观察）。 */
    responses: AgentResponse[];
    timestamp: Date;
}

/**
 * 代表 Agent 感知到的整个世界状态的快照。
 * 这是 Agent 进行决策时最重要的输入信息。
 */
export interface WorldState {
    /** 快照生成的时间戳。 */
    timestamp: string;
    /** Agent 判断为需要关注的活跃频道列表。 */
    activeChannels: Channel[];
    /** Agent 判断为暂时无需关注的非活跃频道列表。 */
    inactiveChannels: Channel[];
}
