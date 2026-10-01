import { AsyncLocalStorage } from "node:async_hooks";
import type { ReplyTarget } from "./reply-control";
import type { Bot, Session } from "koishi";

const turns = new AsyncLocalStorage<{ valid: () => boolean; signal?: AbortSignal; canSend?: (target: ReplyTarget) => boolean }>();
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
            const value = Reflect.get(target, key, receiver);
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
                        return target.sendMessage.apply(onebot ? receiver : target, [channel.id, args[1], null, args[3]]);
                    }
                    const destination = { platform: target.platform, selfId: target.selfId, channelId: args[0] };
                    if (turn?.canSend?.(destination) === false) throw new Error("目标会话的回复已被抑制");
                    return value.apply(onebot ? receiver : target, args);
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
