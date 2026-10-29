import { AsyncLocalStorage } from "node:async_hooks";

import type { Bot, Session } from "koishi";

import { MessageDeliveryError, confirmedMessages, messageReceiptSink, type ConfirmedMessage } from "../shared/message-delivery";
import type { ReplyTarget } from "./reply-control";

type ReplyTurn = { valid: () => boolean; signal?: AbortSignal; canSend?: (target: ReplyTarget) => boolean };
const turns = new AsyncLocalStorage<ReplyTurn>();
const guardedBots = new WeakMap<Bot, { bot: Bot; turns: ReplyTurn[] }>();
// 只在受保护的发送期间替换此 bot 实例的 constructor 读取。适配器方法仍以
// 原 bot 为 this（包括 JS 私有字段），共享类和普通发送不受影响。
const encoderScopes = new AsyncLocalStorage<Map<Bot, Function>>();
const outboundScopes = new AsyncLocalStorage<Map<Bot, () => void>>();
const activeEncoders = new WeakMap<Bot, { count: number; constructor: typeof Bot; descriptor?: PropertyDescriptor; restoreTransports: Array<() => void> }>();
const encoderSendToken = Symbol("reply encoder send");

// 不代理整个 bot，也不改变 transport 方法的 this，兼容 JS 私有字段。
// 这里只覆盖编码器通过 bot.internal / bot.http 读取的常见出站接口。
const internalOutbound = new Set([
    "chatPostMessage",
    "startThreadFromMessage",
    "modifyChannel",
    "im.message.create",
    "im.message.reply",
    "im.message.patch",
    "im.message.update",
    "im.image.create",
    "im.file.create",
]);
const internalNamespaces = new Set(["im", "im.message", "im.image", "im.file"]);
function guardTransport(transport: any, key: "internal" | "http", check: () => void, path = ""): any {
    if (!transport || !["object", "function"].includes(typeof transport)) return transport;
    const outbound = (method: PropertyKey) =>
        key === "http"
            ? ["request", "post", "put", "patch", "delete"].includes(String(method))
            : /^(send[A-Z_]|createMessage$|execute$|request$)/.test(String(method)) ||
              internalOutbound.has(path ? `${path}.${String(method)}` : String(method));
    return new Proxy(transport, {
        apply(target, _receiver, args) {
            check();
            return Reflect.apply(target, target, args);
        },
        get(target, method) {
            const value = Reflect.get(target, method, target);
            const nested = path ? `${path}.${String(method)}` : String(method);
            // Lark 的 SDK 按命名空间保存出站方法；只代理已知发送路径，
            // 不遍历响应对象或改变读取接口的调用接收者。
            if (key === "internal" && internalNamespaces.has(nested)) return guardTransport(value, key, check, nested);
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
    check: (channelId: string, guildId?: string) => void,
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
            if (guarded) {
                delete encoderOptions[encoderSendToken];
                delete encoderOptions[messageReceiptSink];
            }
            const receiptSink = guarded ? args[3]?.[messageReceiptSink] : undefined;
            const encoderArgs = [...args];
            // OneBot enforces destination checks through its bot receiver.
            encoderArgs[0] = guardedBots.has(args[0]) ? args[0] : bot;
            if (guarded) encoderArgs[3] = encoderOptions;
            const encoder = Reflect.construct(target, encoderArgs);
            for (const key of ["send", "prepare", "render", "visit", "flush"] as const) {
                const method = encoder[key];
                if (typeof method !== "function") continue;
                encoder[key] = function (...args: any[]) {
                    if (guarded) check(encoder.channelId, encoder.session?.guildId);
                    const scope = new Map(outboundScopes.getStore());
                    // 普通发送在自己的编码器中移除父异步链的旧保护。
                    if (guarded) scope.set(bot, () => check(encoder.channelId, encoder.session?.guildId));
                    else scope.delete(bot);
                    const result = outboundScopes.run(scope, () => method.apply(encoder, args));
                    if (guarded && key === "send") {
                        return Promise.resolve(result)
                            .then((value) => {
                                receiptSink?.(Array.isArray(encoder.results) ? encoder.results : []);
                                return value;
                            })
                            .catch((error) => {
                                const deliveryError = new MessageDeliveryError(error, Array.isArray(encoder.results) ? encoder.results : []);
                                if (deliveryError.messages.length) throw deliveryError;
                                throw error;
                            });
                    }
                    return result;
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
/** Capture adapter-confirmed content while preserving the guarded bot's send path. */
export async function sendMessageWithReceipts(bot: Bot, channelId: string, content: Parameters<Bot["sendMessage"]>[1], referrer?: any, options?: any) {
    let raw = bot;
    while (guardedBots.has(raw)) raw = guardedBots.get(raw)!.bot;
    let messages: ConfirmedMessage[] | undefined;
    const sendOptions = {
        ...options,
        [messageReceiptSink]: (receipts: ConfirmedMessage[]) => {
            messages = confirmedMessages(receipts);
        },
    };
    // Adapters without encoders retain their exact calling convention.
    if (!(raw.constructor as typeof Bot).MessageEncoder) {
        const ids = await bot.sendMessage(channelId, content, referrer, options);
        return { ids, messages };
    }
    const ids = await withGuardedEncoder(
        raw,
        channelId,
        sendOptions,
        () => {},
        (scopedOptions) => bot.sendMessage(channelId, content, referrer, scopedOptions),
    );
    return { ids, messages };
}
export function isReplyTurnCancelled(): boolean {
    const turn = turns.getStore();
    return turn?.signal?.aborted === true || turn?.valid() === false;
}
export function assertReplyTurn(): void {
    if (isReplyTurnCancelled()) throw new DOMException("聊天任务已取消", "AbortError");
}
/** 取消后释放调用方；扩展的迟到结果仍被消费，不恢复旧任务。 */
export async function awaitReplyTurn<T>(task: () => Promise<T>): Promise<T> {
    assertReplyTurn();
    const signal = replyTurnSignal();
    let abort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new DOMException("聊天任务已取消", "AbortError"));
        signal?.addEventListener("abort", abort, { once: true });
    });
    try {
        const result = await Promise.race([task(), cancelled]);
        assertReplyTurn();
        return result;
    } finally {
        signal?.removeEventListener("abort", abort!);
    }
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
/** Add a history guard without dropping the enclosing pause/mute restrictions. */
export function withReplyTurnGuard<T>(valid: () => boolean, task: () => T, signal: AbortSignal): T {
    const parent = turns.getStore();
    return withReplyTurn(() => valid() && parent?.valid() !== false, task, parent?.signal ? AbortSignal.any([parent.signal, signal]) : signal, parent?.canSend);
}
export function guardReplyBot(bot: Bot): Bot {
    const turn = turns.getStore();
    if (!turn) return bot;
    // Flatten existing wrappers so a single encoder carries every restriction.
    // Keeping the captured turns also prevents an old session reviving in a new turn.
    const previous = guardedBots.get(bot);
    const restrictions = [...new Set([...(previous?.turns ?? []), turn])];
    bot = previous?.bot ?? bot;
    const check = () => {
        if (restrictions.some((restriction) => restriction.signal?.aborted || !restriction.valid())) throw new DOMException("聊天任务已取消", "AbortError");
    };
    const canSend = (target: ReplyTarget) => restrictions.every((restriction) => restriction.canSend?.(target) !== false);
    const destination = (channelId: string, isDirect?: boolean, guildId?: string) => {
        check();
        if (!canSend({ platform: bot.platform!, selfId: bot.selfId, channelId, isDirect, guildId })) throw new Error("目标会话的回复已被抑制");
    };
    // OneBot 在内容转换、before-send 和分段发送之后才调用这些出站方法。
    // 只代理本次回复，普通指令仍使用原机器人和 internal。
    // 旧频道适配器暴露 OneBot 发送接口；同名平台也可能使用独立的编码器。
    const onebot = bot.platform === "onebot" || (bot.platform === "qqguild" && typeof bot.internal?.sendGuildChannelMsg === "function");
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
    const guarded = new Proxy(bot, {
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
                        if (!canSend({ platform: target.platform!, selfId: target.selfId, channelId: channel.id, isDirect: true }))
                            throw new Error("目标会话的回复已被抑制");
                        const send = (options = args[3]) => target.sendMessage.apply(onebot ? receiver : target, [channel.id, args[1], null, options]);
                        return onebot ? send() : withGuardedEncoder(target, channel.id, args[3], (id) => destination(id, true), send);
                    }
                    const isDirect = key === "sendMessage" ? args[3]?.session?.isDirect : undefined;
                    const guildId = key === "sendMessage" ? args[3]?.session?.guildId : undefined;
                    const targetDestination = { platform: target.platform!, selfId: target.selfId, channelId: args[0] as string, isDirect, guildId };
                    if (!canSend(targetDestination)) throw new Error("目标会话的回复已被抑制");
                    if (onebot || key === "sendUpload") return value.apply(onebot ? receiver : target, args);
                    const send = (options: any) => {
                        const sendArgs = [...args];
                        if (options !== args[3]) sendArgs[3] = options;
                        return value.apply(target, sendArgs);
                    };
                    return withGuardedEncoder(target, args[0], args[3], (id, parent) => destination(id, isDirect, parent ?? guildId), send);
                };
            }
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    guardedBots.set(guarded, { bot, turns: restrictions });
    return guarded;
}
export function guardReplySession(session: Session): Session {
    const turn = turns.getStore();
    const check = () => {
        if (turn?.signal?.aborted || turn?.valid() === false) throw new DOMException("聊天任务已取消", "AbortError");
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
