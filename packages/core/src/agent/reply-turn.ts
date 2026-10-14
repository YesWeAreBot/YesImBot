import { AsyncLocalStorage } from "node:async_hooks";

import type { Bot, Session } from "koishi";

import type { ReplyTarget } from "./reply-control";

const turns = new AsyncLocalStorage<{ valid: () => boolean; signal?: AbortSignal; canSend?: (target: ReplyTarget) => boolean }>();
// 只在受保护的发送期间替换此 bot 实例的 constructor 读取。适配器方法仍以
// 原 bot 为 this（包括 JS 私有字段），共享类和普通发送不受影响。
const encoderScopes = new AsyncLocalStorage<Map<Bot, Function>>();
const outboundScopes = new AsyncLocalStorage<Map<Bot, () => void>>();
const activeEncoders = new WeakMap<Bot, { count: number; constructor: typeof Bot; descriptor?: PropertyDescriptor; restoreTransports: Array<() => void> }>();
const encoderSendToken = Symbol("reply encoder send");

// 不代理整个 bot，也不改变 transport 方法的 this，兼容 JS 私有字段。
// 这里只覆盖编码器通过 bot.internal / bot.http 读取的常见出站接口。
function guardTransport(transport: any, key: "internal" | "http", check: () => void): any {
    if (!transport || !["object", "function"].includes(typeof transport)) return transport;
    const outbound = (method: PropertyKey) =>
        key === "http"
            ? ["request", "post", "put", "patch", "delete"].includes(String(method))
            : /^(send[A-Z_]|createMessage$|execute$|request$)/.test(String(method));
    return new Proxy(transport, {
        apply(target, _receiver, args) {
            check();
            return Reflect.apply(target, target, args);
        },
        get(target, method) {
            const value = Reflect.get(target, method, target);
            if (typeof value !== "function") return value;
            return (...args: any[]) => {
                if (outbound(method)) check();
                // Cordis HTTP.extend 返回的新客户端也需要保持本次调用的检查。
                const result = Reflect.apply(value, target, args);
                return key === "http" && method === "extend" ? guardTransport(result, key, check) : result;
            };
        },
    });
}

function scopeTransport(bot: Bot, key: "internal" | "http"): () => void {
    const own = Object.getOwnPropertyDescriptor(bot, key);
    let source = own;
    for (let proto = Object.getPrototypeOf(bot); !source && proto; proto = Object.getPrototypeOf(proto)) source = Object.getOwnPropertyDescriptor(proto, key);
    if (!source) return () => {};
    if (own?.configurable === false || (!own && !Object.isExtensible(bot))) throw new Error(`无法保护回复出站：bot.${key} 属性不可配置`);
    let stored = source.value;
    let assigned = false;
    const read = () => (source.get ? source.get.call(bot) : stored);
    const descriptor: PropertyDescriptor = {
        configurable: true,
        enumerable: source.enumerable,
        get() {
            const value = read();
            const check = outboundScopes.getStore()?.get(bot);
            return check ? guardTransport(value, key, check) : value;
        },
    };
    if (source.set) descriptor.set = (value) => source.set!.call(bot, value);
    else if (source.writable)
        descriptor.set = (value) => {
            stored = value;
            assigned = true;
        };
    Object.defineProperty(bot, key, descriptor);
    return () => {
        if (own) Object.defineProperty(bot, key, "value" in own ? { ...own, value: stored } : own);
        else if (assigned) Object.defineProperty(bot, key, { value: stored, configurable: true, writable: true, enumerable: true });
        else delete (bot as any)[key];
    };
}

async function withGuardedEncoder<T>(
    bot: Bot,
    channelId: string,
    options: any,
    check: (channelId: string) => void,
    task: (options: any) => T,
): Promise<Awaited<T>> {
    // 内层新 turn 必须从真实适配器类构造，避免嵌套旧代理擦除新 turn 的上下文。
    const constructor = activeEncoders.get(bot)?.constructor ?? (bot.constructor as typeof Bot);
    const Encoder = constructor.MessageEncoder;
    if (!Encoder) return await task(options);
    const token = {};
    const sendOptions = { ...options, [encoderSendToken]: token };
    const guardedEncoder = new Proxy(Encoder, {
        construct(target, args) {
            // 同 bot、频道和异步链上的普通发送/新 turn 也必须有本次调用的令牌。
            const guarded = args[3]?.[encoderSendToken] === token && String(args[1]) === String(channelId);
            const encoderOptions = { ...args[3] };
            if (guarded) delete encoderOptions[encoderSendToken];
            const encoderArgs = [...args];
            encoderArgs[0] = bot;
            if (guarded) encoderArgs[3] = encoderOptions;
            const encoder = Reflect.construct(target, encoderArgs);
            for (const key of ["send", "prepare", "render", "visit", "flush"] as const) {
                const method = encoder[key];
                if (typeof method !== "function") continue;
                encoder[key] = function (...args: any[]) {
                    if (guarded) check(encoder.channelId);
                    const scope = new Map(outboundScopes.getStore());
                    // 普通发送在自己的编码器中移除父异步链的旧保护。
                    if (guarded) scope.set(bot, () => check(encoder.channelId));
                    else scope.delete(bot);
                    return outboundScopes.run(scope, () => method.apply(encoder, args));
                };
            }
            return encoder;
        },
    });
    const guardedConstructor = new Proxy(constructor, {
        get(target, key) {
            return key === "MessageEncoder" ? guardedEncoder : Reflect.get(target, key, target);
        },
    });
    let active = activeEncoders.get(bot);
    if (!active) {
        active = { count: 0, constructor, descriptor: Object.getOwnPropertyDescriptor(bot, "constructor"), restoreTransports: [] };
        try {
            for (const key of ["internal", "http"] as const) active.restoreTransports.push(scopeTransport(bot, key));
            Object.defineProperty(bot, "constructor", {
                configurable: true,
                get: () => encoderScopes.getStore()?.get(bot) ?? constructor,
            });
        } catch (error) {
            active.restoreTransports.reverse().forEach((restore) => restore());
            throw error;
        }
        activeEncoders.set(bot, active);
    }
    active.count++;
    const scope = new Map(encoderScopes.getStore());
    scope.set(bot, guardedConstructor);
    try {
        return await encoderScopes.run(scope, () => task(sendOptions));
    } finally {
        if (--active.count === 0) {
            if (active.descriptor) Object.defineProperty(bot, "constructor", active.descriptor);
            else delete (bot as any).constructor;
            active.restoreTransports.reverse().forEach((restore) => restore());
            activeEncoders.delete(bot);
        }
    }
}
export function assertReplyTurn(): void {
    if (turns.getStore()?.valid() === false) throw new Error("聊天任务已取消");
}
export function assertReplyDestination(target: ReplyTarget): void {
    assertReplyTurn();
    if (turns.getStore()?.canSend?.(target) === false) throw new Error("目标会话的回复已被抑制");
}
export function replyTurnSignal(): AbortSignal | undefined {
    return turns.getStore()?.signal;
}
export function withReplyTurn<T>(valid: () => boolean, task: () => T, signal?: AbortSignal, canSend?: (target: ReplyTarget) => boolean): T {
    return turns.run({ valid, signal, canSend }, task);
}
export function guardReplyBot(bot: Bot): Bot {
    const turn = turns.getStore();
    if (!turn) return bot;
    const valid = turn?.valid;
    const check = () => {
        if (valid?.() === false) throw new Error("聊天任务已取消");
    };
    const destination = (channelId: string, isDirect?: boolean) => {
        check();
        if (turn.canSend?.({ platform: bot.platform!, selfId: bot.selfId, channelId, isDirect }) === false) throw new Error("目标会话的回复已被抑制");
    };
    // OneBot 在内容转换、before-send 和分段发送之后才调用这些出站方法。
    // 只代理本次回复，普通指令仍使用原机器人和 internal。
    const onebot = bot.platform === "onebot" || bot.platform === "qqguild";
    const internal =
        onebot && bot.internal
            ? new Proxy(bot.internal, {
                  get(target, key, receiver) {
                      const value = Reflect.get(target, key, receiver);
                      if (typeof value !== "function") return value;
                      return (...args: any[]) => {
                          const method = String(key).replace(/Async$/, "");
                          if (["sendGroupMsg", "sendGroupForwardMsg", "uploadGroupFile"].includes(method)) destination(String(args[0]));
                          else if (["sendPrivateMsg", "sendPrivateForwardMsg", "uploadPrivateFile"].includes(method)) destination(`private:${args[0]}`, true);
                          else if (method === "sendGuildChannelMsg") destination(String(args[1]));
                          else if (method === "sendMsg") {
                              const group = args[1] !== undefined && args[1] !== null;
                              destination(group ? String(args[1]) : `private:${args[0]}`, !group);
                          }
                          return value.apply(target, args);
                      };
                  },
              })
            : bot.internal;
    return new Proxy(bot, {
        get(target, key, receiver) {
            if (key === "constructor") return target.constructor;
            if (key === "internal") return internal;
            const value = Reflect.get(target, key, onebot ? receiver : target);
            if (onebot && key === "createMessage" && typeof value === "function") {
                return (...args: any[]) => {
                    check();
                    return value.apply(receiver, args);
                };
            }
            if (typeof value === "function" && ["sendMessage", "sendPrivateMessage", "sendUpload"].includes(String(key))) {
                return async (...args: any[]) => {
                    check();
                    if (key === "sendPrivateMessage") {
                        const channel = await target.createDirectChannel(args[0], args[2] ?? args[3]?.session?.guildId);
                        check();
                        if (turn?.canSend?.({ platform: target.platform!, selfId: target.selfId, channelId: channel.id, isDirect: true }) === false)
                            throw new Error("目标会话的回复已被抑制");
                        const send = (options = args[3]) => target.sendMessage.apply(onebot ? receiver : target, [channel.id, args[1], null, options]);
                        return onebot ? send() : withGuardedEncoder(target, channel.id, args[3], (id) => destination(id, true), send);
                    }
                    const targetDestination = { platform: target.platform!, selfId: target.selfId, channelId: args[0] as string };
                    if (turn?.canSend?.(targetDestination) === false) throw new Error("目标会话的回复已被抑制");
                    if (onebot || key === "sendUpload") return value.apply(onebot ? receiver : target, args);
                    const send = (options: any) => {
                        const sendArgs = [...args];
                        if (options !== args[3]) sendArgs[3] = options;
                        return value.apply(target, sendArgs);
                    };
                    return withGuardedEncoder(target, args[0], args[3], (id) => destination(id), send);
                };
            }
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
export function guardReplySession(session: Session): Session {
    const turn = turns.getStore();
    const check = () => {
        if (turn?.valid() === false) throw new Error("聊天任务已取消");
    };
    const bot = guardReplyBot(session.bot);
    return new Proxy(session, {
        get(target, key, receiver) {
            if (key === "bot") return bot;
            const value = Reflect.get(target, key, receiver);
            if (typeof value === "function" && ["send", "sendQueued", "execute"].includes(String(key))) {
                return async (...args: any[]) => {
                    check();
                    return value.apply(receiver, args);
                };
            }
            return value;
        },
    });
}
