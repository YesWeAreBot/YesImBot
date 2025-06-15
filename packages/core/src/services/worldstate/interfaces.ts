export interface WorldState {
    timestamp: string;
    activeChannels: Channel[];
    inactiveChannels: Channel[];
}

// 一个频道对象，替换原来的 Scenario
// 群组或是私聊，或者沙盒测试环境
export interface Channel {
    id: string; // 频道 ID
    name: string; // 频道名称，群聊就是群组名，私聊为“你和 <用户名> 的私聊”
    type: "guild" | "private" | "sandbox";
    platform: string;
    meta: {
        description?: string; // 频道描述，有些适配器获取不到。或许可以根据历史对话生成一个
    };
    // 经过智能筛选和摘要的成员信息
    // 层次1: 核心成员，如群主、管理员，或与自己有特殊关系的成员
    // 层次2: 上下文相关成员 (近期发言或被@)
    members: Member[];

    // 层次3: 群体氛围感知的摘要信息
    memberSummary: MemberSummary;
    history: Turn[];
}

export interface MemberSummary {
    total_count: number; // 频道成员总数
    online_count: number; // 频道在线成员数
    recent_active_members_count: number; // 频道近期活跃成员数
}

export interface User {
    id: string; // 特点平台用户 ID (pid)
    name: string; // 用户名称
    meta: {
        avatar?: string; // 用户头像 URL
        [key: string]: unknown;
    };
    created_at: Date;
    updated_at: Date;
}

export interface Member extends User {
    channel_id: string;
    meta: User["meta"] & {
        nick?: string;
        role?: string;
    };
    last_active?: string; // 用户上次活跃时间
}

export interface Turn {
    id: string;
    status: "full" | "summarized" | "folded" | "new";
    events: ChannelEvent[];
    summary?: string; // 摘要
    responses: AgentResponse[];
}

export interface AgentResponse {
    thoughts: Thought;
    actions: Action[];
    observations: ActionResult[];
}

export interface Thought {
    obverse: string;
    analyze_infer: string;
    plan: string;
}

export interface Action {
    function: string;
    params: Record<string, unknown>;
}

export interface ActionResult {
    function: string;
    result: {
        success: boolean;
        result?: unknown;
        error?: unknown;
    };
}

// --- 事件相关接口 ---

// 基础事件结构
interface BaseEvent {
    id: number; // 自增 ID
    type: string;
    timestamp: Date;
}

// 具体事件类型定义
export interface UserJoinedEvent extends BaseEvent {
    type: "user_joined";
    actor: Member; // 操作者 (可能是系统或其他成员)
    user: Member; // 加入的成员
    note?: string;
}

export interface UserLeftEvent extends BaseEvent {
    type: "user_left";
    actor: Member;
    user: Member;
    reason?: string;
}

export interface MessageSentEvent extends BaseEvent {
    type: "message_sent";
    messageId: string;
    sender: Member;
    content: string;
}

export interface SystemNotificationEvent extends BaseEvent {
    type: "system_notification";
    content: string;
}

export type ChannelEvent = UserJoinedEvent | UserLeftEvent | MessageSentEvent | SystemNotificationEvent;