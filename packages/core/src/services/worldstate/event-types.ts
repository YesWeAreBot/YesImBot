// --- 事件系统 (Event System) ---

import { User } from "koishi";

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
