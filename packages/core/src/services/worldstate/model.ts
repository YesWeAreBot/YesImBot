import { Context } from "koishi";

export enum TableName {
    Members = "yesimbot.members",
    /** 新增：存储用户主导的连续对话流 */
    DialogueSegments = "yesimbot.dialogue_segments",
    /** 重命名：存储 Agent 的思考和行动回合 */
    AgentTurns = "yesimbot.agent_turns",
    Events = "yesimbot.events",
    AgentResponses = "yesimbot.agent_responses",
}

// --- 数据库表的数据传输对象 (DTOs) ---
// 这些接口精确匹配数据库表的每一行结构，是纯粹的数据载体。

/**
 * `yesimbot.members` 表的数据结构。
 * 存储用户在一个特定频道内的附加信息，是对 Koishi 内置 'user' 表的补充。
 */
export interface MemberData {
    // 复合主键: [uid, platform, channelId]
    /** 关联的 Koishi 用户ID (user.id) */
    uid: number;
    /** 平台名称，如 'onebot', 'discord' */
    platform: string;
    /** 频道ID */
    channelId: string;

    // --- 反范式字段，用于高效查询 ---
    /** 平台用户ID */
    pid: string;

    // --- 业务字段 ---
    /** 用户在该频道的最后活跃时间 */
    lastActive: Date;
    /** 由 Agent 或管理员赋予的内部角色，可用于逻辑判断 */
    roleOverride: string;
    /** 由 Agent 或管理员赋予的内部昵称，可用于覆盖平台昵称 */
    nickOverride: string;
}

/** 新增：yesimbot.dialogue_segments 表的数据结构 */
export interface DialogueSegmentData {
    id: string;
    channelId: string;
    platform: string;
    /**
     * 片段的生命周期状态:
     * - open: 开放中，正在接收新事件。
     * - closed_by_agent: 被 Agent 的一个回合所关闭。
     * - closed_by_timeout: 因长时间无活动被后台关闭。
     * - closed_by_lifecycle: 因 Agent 生命周期变化被关闭。
     */
    status: "open" | "closed_by_agent" | "closed_by_timeout" | "closed_by_lifecycle" | "summarized";
    summary: string;
    startTimestamp: Date;
    endTimestamp: Date;
}

/** 重命名：yesimbot.agent_turns 表的数据结构 */
export interface AgentTurnData {
    id: string;
    /** 外键，关联到触发此回合的对话片段 */
    stimulusSegmentId: string;
    channelId: string;
    platform: string;
    /**
     * Agent 回合的生命周期状态:
     * - in_progress: Agent 正在处理中。
     * - completed: Agent 处理完成。
     */
    status: "in_progress" | "completed";
    startTimestamp: Date;
    endTimestamp: Date;
}

export interface EventData {
    id: string;
    /** 修改：外键现在指向 DialogueSegment */
    segmentId: string;
    type: string;
    timestamp: Date;
    payload: object;
}

export interface AgentResponseData {
    id: number;
    /** 修改：外键现在指向 AgentTurn */
    turnId: string;
    thoughts: object;
    actions: object;
    observations: object;
}

declare module "koishi" {
    interface Tables {
        [TableName.Members]: MemberData;
        /** 新增 */
        [TableName.DialogueSegments]: DialogueSegmentData;
        /** 重命名 */
        [TableName.AgentTurns]: AgentTurnData;
        [TableName.Events]: EventData;
        [TableName.AgentResponses]: AgentResponseData;
    }
    // ... Channel 接口扩展保持不变 ...

    interface Channel {
        name: string;
        memberCount: number;
        lastActivityAt: Date;
        meta: object;
    }
}

export function apply(ctx: Context) {
    // --- 1. 扩展 Koishi 内置的 'channel' 表 ---
    ctx.model.extend("channel", {
        // --- 关键字段，使用独立列以获得最佳查询性能 ---
        /** 缓存的频道名称，用于显示和搜索 */
        name: "string(255)",
        /** 缓存的频道成员数量，可用于数据分析和查询 */
        memberCount: "unsigned",
        /** 频道的最后活跃时间，用于识别活跃频道和排序 */
        lastActivityAt: "timestamp",

        // --- 非关键或结构易变的扩展数据，放入JSON字段以获得灵活性 ---
        /**
         * 存储如 description, topic, tags 等非关键信息的JSON对象。
         * 优点: 扩展灵活，无需修改表结构。
         * 缺点: 无法高效查询内部字段。
         */
        meta: "json",
    });
    ctx.model.extend(
        TableName.Members,
        {
            uid: "unsigned",
            platform: "string(255)",
            channelId: "string(255)",
            pid: "string(255)",
            lastActive: "timestamp",
            roleOverride: "string",
            nickOverride: "string",
        },
        {
            // 定义复合主键，确保一个用户在一个频道中只有一条记录
            primary: ["uid", "platform", "channelId"],

            foreign: {
                uid: ["user", "id"],
                pid: ["binding", "pid"],
            },
        }
    );

    // --- 2. 定义我们的自定义表 ---

    /** 新增：定义 'yesimbot.dialogue_segments' 表 */
    ctx.model.extend(
        TableName.DialogueSegments,
        {
            id: "string(64)",
            channelId: "string(255)",
            platform: "string(255)",
            status: "string(32)",
            summary: "text",
            startTimestamp: "timestamp",
            endTimestamp: "timestamp",
        },
        { primary: "id" }
    );

    /** 重命名并修改：定义 'yesimbot.agent_turns' 表 */
    ctx.model.extend(
        TableName.AgentTurns,
        {
            id: "string(64)",
            stimulusSegmentId: "string(64)",
            channelId: "string(255)",
            platform: "string(255)",
            status: "string(32)",
            startTimestamp: "timestamp",
            endTimestamp: "timestamp",
        },
        {
            primary: "id",
            foreign: {
                stimulusSegmentId: [TableName.DialogueSegments, "id"],
            },
        }
    );

    /** 修改：定义 'yesimbot.events' 表 */
    ctx.model.extend(
        TableName.Events,
        {
            id: "string(64)",
            segmentId: "string(64)", // 修改
            type: "string(64)",
            timestamp: "timestamp",
            payload: "json",
        },
        {
            primary: "id",
            foreign: {
                segmentId: [TableName.DialogueSegments, "id"], // 修改
            },
        }
    );

    /** 修改：定义 'yesimbot.agent_responses' 表 */
    ctx.model.extend(
        TableName.AgentResponses,
        {
            id: "unsigned",
            turnId: "string(64)", // 指向 AgentTurn 的 ID
            thoughts: "json",
            actions: "json",
            observations: "json",
        },
        {
            autoInc: true,
            primary: "id",
            foreign: {
                turnId: [TableName.AgentTurns, "id"], // 修改
            },
        }
    );
}
