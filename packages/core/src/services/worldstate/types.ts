/**
 * @file interfaces.ts
 * @description 定义插件的核心领域对象 (Domain Objects)
 *
 * 与 `database-models.ts` 中的数据传输对象 (DTOs) 不同，本文件中的接口代表了业务逻辑操作的核心
 * 它们通常由仓储层 (Repository) 负责从数据库的 DTOs 构建，并可能包含业务方法或更丰富的结构
 * 这些对象是 Agent 感知世界和进行决策的基础
 */

import { Element, User } from "koishi";

type Genres = "friend" | "channel" | "guild" | "guild-member" | "guild-role" | "guild-file" | "guild-emoji";
type Actions = "added" | "deleted" | "updated";

/**
 * 定义了所有可能被捕获的 Koishi 事件名称的联合类型，提供类型安全
 */
export type EventName =
    | string // 兜底类型，允许任意字符串
    | `${Genres}-${Actions}`
    | "message"
    | "message-deleted"
    | "message-updated"
    | "message-pinned"
    | "message-unpinned"
    | "interaction/command"
    | "reaction-added"
    | "reaction-deleted"
    | "reaction-deleted/one"
    | "reaction-deleted/all"
    | "reaction-deleted/emoji"
    | "send"
    | "friend-request"
    | "guild-request"
    | "guild-member-request";

/**
 * 所有非消息类系统事件的基类接口
 * @template T 事件名称的类型
 * @template P 事件负载 (payload) 的类型
 */
export interface BaseSystemEvent<T extends EventName, P extends object> {
    id: string;
    type: T;
    timestamp: Date;
    payload: P;
}

/** 通用系统事件，用于未明确定义具体类型的事件 */
export type GenericSystemEvent = BaseSystemEvent<string, object>;

/** 示例：一个具体的成员加入事件类型 */
export type MemberJoinEvent = BaseSystemEvent<"guild-member-added", { user: User; operator?: User }>;

/**
 * 定义一个指令调用事件的负载结构
 * 我们只记录安全和必要的信息
 */
export interface CommandInvocationPayload {
    name: string; // 指令名称
    source: string; // 用户输入的原始文本
    invoker: {
        // 调用者信息
        pid: string;
        name: string;
    };
    // 用于存储指令执行结果的可选字段
    result?: string;
}

/**
 * 定义一个具体的指令调用事件类型
 */
export type CommandInvocationEvent = BaseSystemEvent<"command-invoked", CommandInvocationPayload>;

/**
 * `SystemEvent` 是所有非消息事件的联合类型
 * 未来可以通过向此联合类型添加更多具体的事件类型来扩展事件系统
 */
export type SystemEvent = GenericSystemEvent | MemberJoinEvent | CommandInvocationEvent;

// --- 基础实体 (Entities) ---

/**
 * 代表一个群组或服务器中的成员，是用户在特定群组上下文中的表现
 */
export interface GuildMember {
    /** 关联的用户平台 ID (pid) */
    pid: string;
    /** 成员在群内的显示名称 (通常是昵称) */
    nick?: string;
    /** 成员的全局用户名 */
    name?: string;
    /** 成员拥有的角色列表 */
    roles?: string[];
    /** 加入群组的时间戳 */
    joinedAt?: Date;
    /** [NEW] 一个布尔值，用于明确标记此成员是否为机器人自身 */
    isSelf?: boolean;
}

/**
 * 代表一个群组
 */
export interface Guild {
    /** 平台提供的唯一群组ID */
    id: string;
    /** 群组名称 */
    name?: string;
    /** 群组头像URL */
    avatar?: string;
}

/**
 * 代表一个通信频道，可以是群组中的一个子频道，也可以是私聊
 */
export interface Channel {
    /** 频道ID在私聊中，这通常是与对方用户的ID关联的标识 */
    id: string;
    /** 频道名称群聊时为群名，私聊时可格式化为 "与 <用户名> 的私聊" */
    name: string;
    /** 频道类型：'guild' (群组频道) 或 'private' (私聊) */
    type: "guild" | "private" | string;
    /** 所属平台名称 (如 'onebot', 'discord') */
    platform: string;
    /** 扩展元信息 */
    meta: {
        description?: string;
    };
    /** 最近活跃的成员列表 */
    members?: GuildMember[];
    /**
     * 频道的历史记录流
     * 这是一个包含对话片段 (DialogueSegment) 的有序数组，
     * 共同构成了 Agent 感知到的频道交互全貌
     */
    history: History;
}

/**
 * 频道的历史记录流
 * pending: 包含新的、未处理的消息
 * closed: 包含已处理的消息，但未被折叠
 * folded: 包含已折叠的消息
 * summarized: 包含已总结的消息
 */
export interface History {
    pending: PendingDialogueSegment;
    closed?: ClosedDialogueSegment[];
    folded?: FoldedDialogueSegment;
    summarized?: SummarizedDialogueSegment;
}

/**
 * 发送者信息快照
 * 记录了消息发送时刻用户的关键信息
 */
export interface Sender {
    /** 用户的平台唯一ID (pid) */
    id: string;
    /** 发送消息时用户的显示名称 (昵称) */
    name?: string;
    /** 发送消息时用户的角色 */
    roles?: string[];
}

/**
 * 代表在特定上下文中（如一个DialogueSegment里）的一条消息
 */
export interface ContextualMessage {
    id: string;
    /** 消息内容 */
    content: string;
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
 * Agent 的一个完整处理回合，通常对应一次或多次 ReAct 循环
 */
export interface AgentTurn {
    /** 此回合中发生的所有响应步骤（思考->行动->观察） */
    responses: AgentResponse[];
    /** Agent 回合完成的时间戳 */
    timestamp: Date;
}
/**
 * 用户对话片段，聚合了一段时间内的相关消息和系统事件
 */
export interface DialogueSegment {
    type: "dialogue-segment"; // 类型守卫字段
    id: string;
    platform: string;
    channelId: string;
    guildId?: string;
    /**
     * 片段的生命周期状态
     * - `open`: 开放中，正在接收新事件
     * - `closed`: 已关闭，通常在 Agent 介入时发生，等待系统进一步处理
     * - `folded`: 已折叠，其关联的 AgentTurn 因历史过长被从上下文中移除
     * - `summarized`: 已总结，原始内容已被LLM压缩成摘要
     * - `archived`: 已归档，记录在被物理删除前的最终状态，不参与上下文构建
     */
    status: DialogueSegmentStatus;
    startTimestamp: Date; // 片段的创建/开启时间
}

export interface PendingDialogueSegment extends DialogueSegment {
    status: "open";
    dialogue: ContextualMessage[];
    systemEvents: SystemEvent[];
}

export interface ClosedDialogueSegment extends DialogueSegment {
    status: "closed";
    dialogue: ContextualMessage[];
    systemEvents: SystemEvent[];
    agentTurn: AgentTurn;
    endTimestamp: Date;
}

/**
 * 状态为 `folded` 的对话片段集合，将所有折叠片段整合为一个
 */
export interface FoldedDialogueSegment extends DialogueSegment {
    status: "folded";
    dialogue: ContextualMessage[];
    systemEvents: SystemEvent[];
    endTimestamp: Date;
}

/**
 * 状态为 `summarized` 的对话片段，包含一个总结文本，不包含详细对话内容
 * 通常是一个 `folded` 片段总结而来
 */
export interface SummarizedDialogueSegment extends DialogueSegment {
    status: "summarized";
    summary: string;
    endTimestamp: Date;
}

/**
 * 代表 Agent 感知到的整个世界状态的快照
 * 这是 Agent 进行决策时最重要的输入信息
 */
export interface WorldState {
    // 用于存储将来的用户画像
    users?: {
        id: string;
        name: string;
        description: string;
    }[];
    channel: Channel;
}

// --- Agent 响应结构 (ReAct Pattern) ---

/**
 * 代表 Agent 在 ReAct 循环中的一个完整步骤 (Thought -> Action -> Observation)
 */
export interface AgentResponse {
    /**
     * 思考过程 (Thought): Agent 的内心独白
     * - `observe`: 对当前情景的观察和总结
     * - `analyze_infer`: 分析观察结果，进行推理
     * - `plan`: 基于分析和推理，制定下一步行动计划
     */
    thoughts: { observe: string; analyze_infer: string; plan: string };
    /**
     * 行动 (Action): Agent 决定执行的一个或多个具体动作
     */
    actions: Action[];
    /**
     * 观察 (Observation): 执行动作后从环境中获得的结果
     * 这个结果将成为下一个 `AgentResponse` 中 `thoughts.observe` 的输入
     */
    observations: ActionResult[];
    /**
     * 是否请求心跳
     * 若为 true，表示 Agent 希望立即进入下一个处理循环，即使没有新的外部事件
     * 用于需要连续执行多步操作的场景
     */
    request_heartbeat: boolean;
}

/**
 * 定义了一个 Agent 可以执行的动作
 */
export interface Action {
    /** 要调用的函数或工具的名称 */
    function: string;
    /** 调用函数时传入的参数 */
    params: Record<string, unknown>;
}

/**
 * 定义了一个动作执行后的结果
 */
export interface ActionResult {
    /** 执行的函数名称，与 `Action.function` 对应 */
    function: string;
    /** 函数执行的返回结果 */
    status: "success" | "failed" | string;
    result?: any;
    error?: any;
}
