import { AsyncLocalStorage } from "node:async_hooks";
import type { ReplyTarget } from "./reply-control";
import type { Session } from "koishi";

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
export function guardReplySession(session: Session): Session {
    const turn = turns.getStore();
    const valid = turn?.valid;
    const check = () => {
        if (valid?.() === false) throw new Error("聊天任务已取消");
    };
    const bot = new Proxy(session.bot, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
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
                        return target.sendMessage(channel.id, args[1], null, args[3]);
                    }
                    const destination = { platform: target.platform, selfId: target.selfId, channelId: args[0] };
                    if (turn?.canSend?.(destination) === false) throw new Error("目标会话的回复已被抑制");
                    return value.apply(target, args);
                };
            }
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
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
