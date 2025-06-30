/**
 * @file interfaces.ts
 * @description 定义插件的核心领域对象 (Domain Objects)。
 *
 * 与 `model.ts` 中的数据传输对象 (DTOs) 不同，本文件中的接口代表了业务逻辑操作的核心。
 * 它们通常由仓储层 (Repository) 负责从数据库的 DTOs 构建，并可能包含业务方法或更丰富的结构。
 * 这些对象是 Agent 感知世界和进行决策的基础。
 */

import { User } from "koishi";

// --- 基础实体 (Entities) ---

/**
 * 代表一个群组或服务器中的成员，是用户在特定群组上下文中的表现。
 */
export interface GuildMember {
    /** 关联的用户对象。 */
    user?: User;
    /** 成员在群内的昵称。 */
    name?: string;
    nick?: string;
    /** 成员的头像 (可能与全局头像不同)。 */
    avatar?: string;
    /** 成员头衔。 */
    title?: string;
    /** 成员拥有的角色列表。 */
    roles?: string[];
    /** 加入群组的时间戳。 */
    joinedAt?: number;
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
 * 发送者信息。
 * 可以是一个简化的对象，只包含ID、名称和角色等关键信息，
 * 而不是完整的、可无限嵌套的GuildMember对象。
 */
export interface Sender {
    id: string; // 用户的平台唯一ID (pid)
    name?: string; // 发送消息时用户的名称
    nick?: string; // 发送消息时用户的昵称
    roles?: string[]; // 发送消息时用户的角色
}

/**
 * 代表在特定上下文中（如一个DialogueSegment里）的一条消息。
 * 它不包含完整的Channel或Guild对象，而是使用ID引用来避免循环依赖。
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

/**
 * 用户对话片段，聚合了一段时间内的相关消息和系统事件。
 */
export interface DialogueSegment {
    id: string;
    platform: string;
    channelId: string;
    guildId?: string;
    userId?: string;
    /**
     * 片段的生命周期状态。
     * - `open`: 开放中，正在接收新事件。
     * - `closed_by_agent`: 被 Agent 的一个回合 (AgentTurn) 正常关闭。
     * - `closed_by_timeout`: 因长时间无活动被后台任务关闭。
     * - `closed_by_lifecycle`: 因 Agent 生命周期变化（如重启）被关闭。
     * - `summarized`: 已被总结，通常在关闭后进行。
     */
    status: "open" | "closed_by_agent" | "closed_by_timeout" | "closed_by_lifecycle" | "summarized";

    /** 该片段中发生的对话消息流。 */
    dialogue: ContextualMessage[];

    /** 该片段中发生的非消息类系统事件。 */
    systemEvents: SystemEvent[];

    summary?: string;
    timestamp: Date;

    /**
     * 类型守卫或模板渲染提示。
     * 用于在 `history` 数组中方便地识别此对象的类型。
     */
    is_dialogue_segment: true;
}

/**
 * Agent 的一个完整处理回合，通常对应一次 ReAct 循环。
 * 聚合了该回合内所有的思考、行动和观察。
 */
export interface AgentTurn {
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
    status: "in_progress" | "completed";
    /** 此回合中发生的所有响应步骤（思考->行动->观察）。 */
    responses: AgentResponse[];
    timestamp: Date;
    /**
     * 类型守卫或模板渲染提示。
     * 用于在 `history` 数组中方便地识别此对象的类型。
     */
    is_agent_turn: true;
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

// --- 事件系统 (Event System) ---

type Genres = "friend" | "channel" | "guild" | "guild-member" | "guild-role" | "guild-file" | "guild-emoji";
type Actions = "added" | "deleted" | "updated";

/**
 * 定义了所有可能被捕获的 Koishi 事件名称的联合类型，提供类型安全。
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
 * 所有非消息类系统事件的基类接口。
 * @template T 事件名称的类型。
 * @template P 事件负载 (payload) 的类型。
 */
export interface BaseSystemEvent<T extends EventName, P extends object> {
    id: string;
    type: T;
    timestamp: Date;
    payload: P;
}

/** 示例：一个具体的成员加入事件类型。 */
export type MemberJoinEvent = BaseSystemEvent<"guild-member-added", { user: User; operator?: User }>;

/** 通用系统事件，用于未明确定义具体类型的事件。 */
export type GenericSystemEvent = BaseSystemEvent<string, object>;

/**
 * `SystemEvent` 是所有非消息事件的联合类型。
 * 未来可以通过向此联合类型添加更多具体的事件类型来扩展事件系统。
 */
export type SystemEvent = GenericSystemEvent | MemberJoinEvent;

// --- Agent 响应结构 (ReAct Pattern) ---

/**
 * 代表 Agent 在 ReAct 循环中的一个完整步骤 (Thought -> Action -> Observation)。
 */
export interface AgentResponse {
    /**
     * 思考过程 (Thought): Agent 的内心独白。
     * - `observe`: 对当前情景的观察和总结。
     * - `analyze_infer`: 分析观察结果，进行推理。
     * - `plan`: 基于分析和推理，制定下一步行动计划。
     */
    thoughts: { observe: string; analyze_infer: string; plan: string };
    /**
     * 行动 (Action): Agent 决定执行的一个或多个具体动作。
     */
    actions: Action[];
    /**
     * 观察 (Observation): 执行动作后从环境中获得的结果。
     * 这个结果将成为下一个 `AgentResponse` 中 `thoughts.observe` 的输入。
     */
    observations: ActionResult[];
    /**
     * 是否请求心跳。
     * 若为 true，表示 Agent 希望立即进入下一个处理循环，即使没有新的外部事件。
     * 用于需要连续执行多步操作的场景。
     */
    request_heartbeat: boolean;
}

/**
 * 定义了一个 Agent 可以执行的动作。
 */
export interface Action {
    /** 要调用的函数或工具的名称。 */
    function: string;
    /** 调用函数时传入的参数。 */
    params: Record<string, unknown>;
}

/**
 * 定义了一个动作执行后的结果。
 */
export interface ActionResult {
    /** 执行的函数名称，与 `Action.function` 对应。 */
    function: string;
    /** 函数执行的返回结果。 */
    result: any;
}
