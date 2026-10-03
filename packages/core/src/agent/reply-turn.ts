import { AsyncLocalStorage } from "node:async_hooks";
import type { ReplyTarget } from "./reply-control";
import type { Bot, Session } from "koishi";

const turns = new AsyncLocalStorage<{ valid: () => boolean; signal?: AbortSignal; canSend?: (target: ReplyTarget) => boolean }>();
// 只在受保护的发送期间替换此 bot 实例的 constructor 读取。适配器方法仍以
// 原 bot 为 this（包括 JS 私有字段），共享类和普通发送不受影响。
const encoderScopes = new AsyncLocalStorage<Map<Bot, Function>>();
const activeEncoders = new WeakMap<Bot, { count: number; descriptor?: PropertyDescriptor }>();
const encoderSendToken = Symbol("reply encoder send");
async function withGuardedEncoder<T>(bot: Bot, channelId: string, options: any, check: (channelId: string) => void, task: (options: any) => T): Promise<Awaited<T>> {
    const constructor = bot.constructor as typeof Bot;
    const Encoder = constructor.MessageEncoder;
    if (!Encoder) return await task(options);
    const token = {};
    const sendOptions = { ...options, [encoderSendToken]: token };
    const guardedEncoder = new Proxy(Encoder, {
        construct(target, args) {
            // 同 bot、频道和异步链上的普通发送/新 turn 也必须有本次调用的令牌。
            if (args[3]?.[encoderSendToken] !== token || String(args[1]) !== String(channelId)) return Reflect.construct(target, args);
            const encoderOptions = { ...args[3] };
            delete encoderOptions[encoderSendToken];
            const encoderArgs = [...args];
            encoderArgs[0] = bot;
            encoderArgs[3] = encoderOptions;
            const encoder = Reflect.construct(target, encoderArgs);
            for (const key of ["render", "visit", "flush"] as const) {
                const method = encoder[key];
                encoder[key] = function (...args: any[]) {
                    check(encoder.channelId);
                    return method.apply(encoder, args);
                };
            }
            return encoder;
        },
    });
    const guardedConstructor = new Proxy(constructor, {
        get(target, key) { return key === "MessageEncoder" ? guardedEncoder : Reflect.get(target, key, target); },
    });
    let active = activeEncoders.get(bot);
    if (!active) {
        active = { count: 0, descriptor: Object.getOwnPropertyDescriptor(bot, "constructor") };
        Object.defineProperty(bot, "constructor", {
            configurable: true,
            get: () => encoderScopes.getStore()?.get(bot) ?? constructor,
        });
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
        if (turn.canSend?.({ platform: bot.platform, selfId: bot.selfId, channelId, isDirect }) === false)
            throw new Error("目标会话的回复已被抑制");
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
                          else if (["sendPrivateMsg", "sendPrivateForwardMsg", "uploadPrivateFile"].includes(method))
                              destination(`private:${args[0]}`, true);
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
                        if (
                            turn?.canSend?.({ platform: target.platform, selfId: target.selfId, channelId: channel.id, isDirect: true }) ===
                            false
                        )
                            throw new Error("目标会话的回复已被抑制");
                        const send = (options = args[3]) => target.sendMessage.apply(onebot ? receiver : target, [channel.id, args[1], null, options]);
                        return onebot ? send() : withGuardedEncoder(target, channel.id, args[3], id => destination(id, true), send);
                    }
                    const targetDestination = { platform: target.platform, selfId: target.selfId, channelId: args[0] };
                    if (turn?.canSend?.(targetDestination) === false) throw new Error("目标会话的回复已被抑制");
                    if (onebot || key === "sendUpload") return value.apply(onebot ? receiver : target, args);
                    const send = (options: any) => {
                        const sendArgs = [...args];
                        if (options !== args[3]) sendArgs[3] = options;
                        return value.apply(target, sendArgs);
                    };
                    return withGuardedEncoder(target, args[0], args[3], id => destination(id), send);
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
