import { Context } from "koishi";

/**
 * 定义数据库中所有自定义表的名称，以常量形式管理，避免硬编码。
 * 表名统一使用 'yesimbot.' 前缀，以明确归属并防止与 Koishi 内置或其他插件的表名冲突。
 */
export enum TableName {
    /** 存储特定用户在特定频道中的上下文相关状态 */
    Members = "yesimbot.members",
    /** 组织对话流，记录一次完整的“刺激-反应”循环 */
    Turns = "yesimbot.turns",
    /** 原子化地记录所有发生的具体事件 */
    Events = "yesimbot.events",
    /** 存储 Agent 的思考过程和行动决策 */
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

/**
 * `yesimbot.turns` 表的数据结构。
 * 宏观上组织一次完整的对话交互。
 */
export interface TurnData {
    /** 回合的唯一ID，主键 */
    id: string;
    /** 所属的频道ID */
    channelId: string;
    /** 所属的平台 */
    platform: string;
    /**
     * 回合的生命周期状态:
     * - new: 新创建，等待Agent处理。
     * - in_progress: Agent正在处理中（例如，链式思考）。
     * - completed: Agent处理完成。
     * - summarized: (未来扩展) 已被摘要，用于节省上下文。
     */
    status: "new" | "in_progress" | "completed" | "summarized";
    /** (未来扩展) 对此回合的摘要内容 */
    summary: string;
    /** 回合开始时间戳 */
    startTimestamp: Date;
    /** 回合结束时间戳 */
    endTimestamp: Date;
}

/**
 * `yesimbot.events` 表的数据结构。
 * 原子化地记录每一个发生的事件。
 */
export interface EventData {
    /** 事件的唯一ID，主键 (推荐使用ULID或UUID) */
    id: string;
    /** 所属回合的ID，外键 */
    turnId: string;
    /**
     * 事件类型，用于解析 'payload' 字段。
     * 例如: 'message', 'member-joined', 'member-left'
     */
    type: string;
    /** 事件发生的时间戳 */
    timestamp: Date;
    /**
     * 存储事件具体信息的JSON对象。
     * 其结构由事件的 'type' 决定，只包含关联ID和核心数据。
     */
    payload: object;
}

/**
 * `yesimbot.agent_responses` 表的数据结构。
 * 记录 Agent 在一个回合中的每一次思考、决策和行动。
 */
export interface AgentResponseData {
    /** 自增主键 */
    id: number;
    /** 所属回合的ID，外键 */
    turnId: string;
    /** 结构化的思考过程 (Observe, Analyze/Infer, Plan) */
    thoughts: object;
    /** 计划执行的工具调用列表 */
    actions: object;
    /** 工具调用后的结果观察列表 */
    observations: object;
}

/**
 * 使用 TypeScript 的模块扩展 (Module Augmentation) 功能，
 * 将我们自定义的表结构注入到 Koishi 的 `Tables` 接口中。
 * 这使得 `ctx.database.get('yesimbot.members', ...)` 等调用能够获得完整的类型提示。
 */
declare module "koishi" {
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Turns]: TurnData;
        [TableName.Events]: EventData;
        [TableName.AgentResponses]: AgentResponseData;
    }

    interface Channel {
        name: string;
        memberCount: number;
        lastActivityAt: Date;
        meta: object;
    }
}

/**
 * 插件的 `apply` 方法，用于在 Koishi 上下文中定义和扩展数据库模型。
 * Koishi 会在启动时自动执行此函数，根据定义创建或更新数据库表。
 * @param ctx Koishi 的上下文对象
 */
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

    // --- 2. 定义我们的自定义表 ---

    // 定义 'yesimbot.members' 表
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

    // 定义 'yesimbot.turns' 表
    ctx.model.extend(
        TableName.Turns,
        {
            id: "string(64)",
            channelId: "string(255)",
            platform: "string(255)",
            status: "string(32)",
            summary: "text",
            startTimestamp: "timestamp",
            endTimestamp: "timestamp",
        },
        {
            primary: "id",
        }
    );

    // 定义 'yesimbot.events' 表
    ctx.model.extend(
        TableName.Events,
        {
            id: "string(64)",
            turnId: "string(64)",
            type: "string(64)",
            timestamp: "timestamp",
            payload: "json",
        },
        {
            primary: "id",
            // 声明外键关系，有助于 ORM 理解模型关联，但部分数据库插件可能不强制执行
            foreign: {
                turnId: [TableName.Turns, "id"],
            },
        }
    );

    // 定义 'yesimbot.agent_responses' 表
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
            autoInc: true, // 使用自增ID作为主键
            primary: "id",
            foreign: {
                turnId: [TableName.Turns, "id"],
            },
        }
    );
}
