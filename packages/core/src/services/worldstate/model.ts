/**
 * @file model.ts
 * @description 定义插件的数据库模型。
 *
 * 本文件包含以下内容：
 * 1.  所有数据库表的名称枚举 (TableName)。
 * 2.  与每个数据库表结构精确匹配的数据传输对象 (DTO) 接口。这些接口是纯粹的数据载体。
 * 3.  使用 `ctx.model.extend()` 将这些表结构注册到 Koishi 的数据库服务中，
 *     定义了字段类型、主键、外键等约束。
 */

import { Context } from "koishi";
import { Action, ActionResult, AgentResponse, AgentTurn, DialogueSegment, EventName, Sender } from "./interfaces";

/**
 * 集中管理所有数据库表的名称，防止拼写错误并方便重构。
 */
export enum TableName {
    Members = "yesimbot.members",
    DialogueSegments = "yesimbot.dialogue_segments",
    AgentTurns = "yesimbot.agent_turns",
    Messages = "yesimbot.messages",
    SystemEvents = "yesimbot.system_events",
    AgentResponses = "yesimbot.agent_responses",
}

// --- 数据库表的数据传输对象 (DTOs) ---

/**
 * `yesimbot.members` 表的数据结构。
 * 存储用户在一个特定频道内的附加信息，作为 Koishi 内置 'user' 表的补充。
 * 主要用于跟踪频道的活跃成员及其状态。
 */
export interface MemberData {
    // --- 复合主键 ---
    /** 关联的 Koishi 用户ID (user.id)，是复合主键的一部分。 */
    uid: number;
    /** 平台名称 (如 'onebot', 'discord')，是复合主键的一部分。 */
    platform: string;
    /** 频道ID，是复合主键的一部分。 */
    channelId: string;

    // --- 关联字段 ---
    /** 用户在对应平台上的唯一ID (pid)。 */
    pid: string;

    name: string;
    nick?: string;
    roles?: string[];
    avatar?: string;
    title?: string;
    joinedAt?: Date;

    // --- 业务字段 ---
    /** 用户在该频道的最后活跃时间。 */
    lastActive: Date;
}

/**
 * `yesimbot.dialogue_segments` 表的数据结构。
 * 一个对话片段代表一段时间内，由用户主导的连续对话或事件流。
 * 当 Agent 开始处理时，当前的开放片段会被关闭。
 */
export interface DialogueSegmentData {
    /** 对话片段的唯一标识符 (UUID)。 */
    id: string;
    /** 所属的频道ID，用于快速查询。 */
    channelId: string;
    /** 所属的平台名称。 */
    platform: string;
    status: DialogueSegment["status"];
    /** (可选) 对此对话片段的文本摘要。 */
    summary?: string;
    /** 片段开始的时间戳。 */
    timestamp: Date;
}

/**
 * `yesimbot.agent_turns` 表的数据结构。
 * 代表 Agent 的一次完整的处理周期（例如一个 ReAct 循环）。
 * 它由一个或多个对话片段 (DialogueSegment) 触发。
 */
export interface AgentTurnData {
    /** Agent 回合的唯一标识符 (UUID)。 */
    id: string;
    /** 外键，关联到触发此回合的对话片段 (DialogueSegment)。 */
    sid: string;
    /** 所属的频道ID，用于快速查询。 */
    channelId: string;
    /** 所属的平台名称。 */
    platform: string;
    status: AgentTurn["status"];
    /** 回合开始的时间戳。 */
    timestamp: Date;
}

/**
 * `yesimbot.messages` 表的数据结构。
 * 存储所有被记录的消息，每条消息都属于一个对话片段。
 */
export interface MessageData {
    /** 平台提供的唯一消息ID，作为主键。 */
    id: string;
    /** 外键，关联到所属的对话片段 (DialogueSegment)。 */
    sid: string;
    /** 频道ID，用于快速过滤。 */
    channelId: string;
    /** 平台名称。 */
    platform: string;
    /** 发送者信息，表示发送消息时的快照。 */
    sender: Sender;
    /** 消息创建时间戳。 */
    timestamp: Date;
    /** 消息内容字符串。*/
    content: string;
    /** (可选) 引用的消息ID。 */
    quoteId?: string;
}

/**
 * `yesimbot.system_events` 表的数据结构。
 * 存储除用户消息外的其他系统级事件，如成员加入、离开等。
 */
export interface SystemEventData {
    /** 事件的唯一标识符 (UUID)。 */
    id: string;
    /** 外键，关联到所属的对话片段 (DialogueSegment)。 */
    sid: string;
    /** 事件类型，其值为 `EventName` 中定义的字符串。 */
    type: EventName;
    /** 事件发生的时间戳。 */
    timestamp: Date;
    /**
     * 事件的详细数据，以 JSON 格式存储。
     * 其具体结构取决于 `type` 字段。
     */
    payload: object;
}

/**
 * `yesimbot.agent_responses` 表的数据结构。
 * 存储 Agent 在一个处理回合 (AgentTurn) 中的具体思考和行动步骤。
 * 一个 AgentTurn 可能包含多个 AgentResponse（例如，多轮 ReAct 循环）。
 */
export interface AgentResponseData {
    /** 自增的唯一ID。 */
    id: number;
    /** 外键，关联到所属的 Agent 回合 (AgentTurn)。 */
    turnId: string;
    /** Agent 的思考过程 (Thoughts)，JSON 格式。 */
    thoughts: AgentResponse["thoughts"];
    /** Agent 计划执行的动作 (Actions)，JSON 格式。 */
    actions: Action[];
    /** 执行动作后得到的观察结果 (Observations)，JSON 格式。 */
    observations: ActionResult[];
    /** 是否请求心跳。 */
    request_heartbeat: boolean;
}

/**
 * 通过 TypeScript 的声明合并 (Declaration Merging)，
 * 将我们定义的表接口加入到 Koishi 的 `Tables` 类型中。
 * 这使得在 `ctx.database` 上进行操作时，能获得完整的类型提示和安全检查。
 */
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

/**
 * Koishi 插件的入口函数，用于在插件启动时注册所有数据库模型。
 * @param ctx 插件上下文对象
 */
export function apply(ctx: Context) {
    // 注册 `members` 表
    ctx.model.extend(
        TableName.Members,
        {
            uid: "unsigned",
            platform: "string(255)",
            channelId: "string(255)",
            name: "string(255)",
            nick: "string(255)",
            roles: "json",
            avatar: "string(255)",
            title: "string(255)",
            joinedAt: "timestamp",
            pid: "string(255)",
            lastActive: "timestamp",
        },
        {
            // 不使用自增主键
            autoInc: false,
            // 定义复合主键，确保一个用户在一个频道中只有一条记录。
            primary: ["uid", "platform", "channelId"],
            // 定义外键，与 Koishi 内置表建立关系，保证数据一致性。
            foreign: {
                uid: ["user", "id"], // 关联到 Koishi 的核心用户表
                pid: ["binding", "pid"], // 关联到平台绑定表
            },
        }
    );

    // 注册 `dialogue_segments` 表
    ctx.model.extend(
        TableName.DialogueSegments,
        {
            id: "string(64)",
            channelId: "string(255)",
            platform: "string(255)",
            status: "string(32)",
            summary: "text",
            timestamp: "timestamp",
        },
        { primary: "id" }
    );

    // 注册 `agent_turns` 表
    ctx.model.extend(
        TableName.AgentTurns,
        {
            id: "string(64)",
            sid: "string(64)",
            channelId: "string(255)",
            platform: "string(255)",
            status: "string(32)",
            timestamp: "timestamp",
        },
        {
            primary: "id",
            foreign: {
                // 外键关联到对话片段表
                sid: [TableName.DialogueSegments, "id"],
            },
        }
    );

    // 注册 `messages` 表
    ctx.model.extend(
        TableName.Messages,
        {
            id: "string(255)",
            sid: "string(64)",
            channelId: "string(255)",
            platform: "string(255)",
            sender: "json",
            timestamp: "timestamp",
            content: "string(255)",
            quoteId: "string(255)",
        },
        {
            // 使用消息ID和平台作为复合主键，确保消息ID在不同平台下可以重复
            primary: ["id", "platform"],
            foreign: {
                // 外键关联到对话片段表
                sid: [TableName.DialogueSegments, "id"],
                // 外键关联到平台绑定表，确保消息发送者是已知用户
                // "sender.id": ["binding", "pid"],
            },
        }
    );

    // 注册 `system_events` 表
    ctx.model.extend(
        TableName.SystemEvents,
        {
            id: "string(64)",
            sid: "string(64)",
            type: "string(64)",
            timestamp: "timestamp",
            payload: "json",
        },
        {
            primary: "id",
            foreign: {
                // 外键关联到对话片段表
                sid: [TableName.DialogueSegments, "id"],
            },
        }
    );

    // 注册 `agent_responses` 表
    ctx.model.extend(
        TableName.AgentResponses,
        {
            id: "unsigned",
            turnId: "string(64)",
            thoughts: "json",
            actions: "json",
            observations: "json",
        },
        {
            // 使用数据库自增ID作为主键
            autoInc: true,
            primary: "id",
            foreign: {
                // 外键关联到 Agent 回合表
                turnId: [TableName.AgentTurns, "id"],
            },
        }
    );
}
