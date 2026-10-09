import { describe, expect, it } from "vitest";

import CoreUtilExtension from "../src/services/extension/builtin/core-util";
import { Services } from "../src/shared/constants";

function setup(send: (...args: any[]) => Promise<string[]> = async () => ["sent"]) {
    const events: any[] = [];
    const disposers: Array<() => void> = [];
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const bot: any = { platform: "qq", selfId: "bot", user: { name: "bot" }, sendMessage: send, session: (event: any) => ({ event }) };
    const ctx: any = {
        bots: [bot],
        on(name: string, callback: () => void) {
            if (name === "dispose") disposers.push(callback);
        },
        logger: () => logger,
        emit: (...args: any[]) => events.push(args),
        [Services.Logger]: { getLogger: () => logger },
        [Services.Asset]: { encode: async (message: string) => message },
    };
    const tool = new CoreUtilExtension(ctx, { typing: { baseDelay: 0, minDelay: 0, maxDelay: 0, charPerSecond: 5 } } as any);
    const session: any = {
        bot,
        platform: "qq",
        selfId: "bot",
        channelId: "group",
        event: { channel: { id: "group" }, referrer: { source: "original" } },
    };
    return { tool, session, bot, ctx, events, dispose: () => disposers.forEach((callback) => callback()) };
}

describe("send_message delivery", () => {
    it("does not report delivery when disposed during the typing delay", async () => {
        let deliveries = 0;
        const { tool, session, dispose } = setup(async () => {
            deliveries++;
            return ["sent"];
        });
        const result = tool.sendMessage({ session, message: "hello" } as any);
        dispose();
        expect((await result).status).toBe("error");
        expect(deliveries).toBe(0);
    });
    for (const channelId of ["group", "private:user"]) {
        it(`preserves passive reply context for ${channelId}`, async () => {
            const received: any[] = [];
            const { tool, session } = setup(async (...args) => {
                received.push(args);
                return ["sent"];
            });
            session.channelId = channelId;
            session.event.channel.id = channelId;
            const result = await tool.sendMessage({ session, message: '<at id="user"/> hello', target: `qq:${channelId}` } as any);
            expect(result.status).toBe("success");
            expect(received[0]).toEqual([channelId, '<at id="user"/> hello', session.event.referrer, { session }]);
        });
    }

    it("shares original reply context across separate paragraphs", async () => {
        const sequences: number[] = [];
        const { tool, session } = setup(async (_channel, _content, _referrer, options) => {
            if (!options?.session?.messageId) throw new Error("missing passive reply id");
            sequences.push((options.session.seq = (options.session.seq || 0) + 1));
            return [`sent-${sequences.length}`];
        });
        session.messageId = "incoming";
        const result = await tool.sendMessage({ session, message: "first<sep/>second" } as any);
        expect(result.status).toBe("success");
        expect(sequences).toEqual([1, 2]);
    });

    for (const target of ["qq:other", "onebot:group"]) {
        it(`does not reuse passive context for ${target}`, async () => {
            const calls: any[] = [];
            const { tool, session, bot, ctx } = setup(async (...args) => {
                calls.push(args);
                return ["sent"];
            });
            ctx.bots.push({ ...bot, platform: "onebot" });
            expect((await tool.sendMessage({ session, message: "hello", target } as any)).status).toBe("success");
            expect(calls[0]).toEqual([target.split(":").slice(1).join(":"), "hello"]);
        });
    }

    it("reports inner QQ errors instead of an empty aggregate message", async () => {
        const error = Object.assign(new Error(""), { errors: [new Error("QQ 消息发送失败 [40054005] duplicate sequence")] });
        const { tool, session, events } = setup(async () => {
            throw error;
        });
        const result = await tool.sendMessage({ session, message: "hello" } as any);
        expect(result.status).toBe("error");
        expect(result.error?.message).toContain("40054005");
        expect(result.error?.message).toContain("duplicate sequence");
        expect(events).toEqual([]);
    });

    it("retains nested errors and ordinary errors", async () => {
        const nested = Object.assign(new Error("aggregate"), {
            errors: [Object.assign(new Error(""), { errors: [new Error("inner reason")] }), new Error("second reason")],
        });
        const { tool, session } = setup(async () => {
            throw nested;
        });
        const result = await tool.sendMessage({ session, message: "hello" } as any);
        expect(result.error?.message).toContain("inner reason");
        expect(result.error?.message).toContain("second reason");
    });

    it("does not report delivery when the adapter returns no message IDs", async () => {
        const { tool, session, events } = setup(async () => []);
        const result = await tool.sendMessage({ session, message: "hello" } as any);
        expect(result.status).toBe("error");
        expect(result.error?.message).toBeTruthy();
        expect(events).toEqual([]);
    });

    it("does not reuse passive context for another bot on the same platform", async () => {
        const calls: any[] = [];
        const { tool, session, bot } = setup();
        const otherBot = {
            ...bot,
            selfId: "other-bot",
            sendMessage: async (...args: any[]) => {
                calls.push(args);
                return ["sent"];
            },
        };
        await (tool as any).sendMessagesWithHumanLikeDelay(["hello"], otherBot, "group", session);
        expect(calls).toEqual([["group", "hello"]]);
    });

    it("keeps the delivered paragraph but does not retry when a later paragraph fails", async () => {
        const attempted: string[] = [];
        const { tool, session, events } = setup(async (_channel, content) => {
            attempted.push(content);
            if (content === "second") throw new Error("later paragraph refused");
            return ["first-sent"];
        });
        const result = await tool.sendMessage({ session, message: "first<sep/>second<sep/>third" } as any);
        expect(result.status).toBe("error");
        expect(result.error?.message).toContain("later paragraph refused");
        expect(attempted).toEqual(["first", "second"]);
        expect(events.length).toBe(1);
        expect(events[0][1].event.message.id).toBe("first-sent");
    });

    for (const error of ["plain rejection", new Error("ordinary error"), Object.assign(new Error("wrapper"), { cause: new Error("root cause") }), null]) {
        it(`provides a readable reason for ${String(error)}`, async () => {
            const { tool, session } = setup(async () => {
                throw error;
            });
            const result = await tool.sendMessage({ session, message: "hello" } as any);
            expect(result.status).toBe("error");
            expect(result.error?.message).toMatch(/plain rejection|ordinary error|root cause|未知发送错误/);
        });
    }

    it("handles circular nested errors without losing the reason", async () => {
        const error: any = new Error("root reason");
        error.errors = [error];
        const { tool, session } = setup(async () => {
            throw error;
        });
        const result = await tool.sendMessage({ session, message: "hello" } as any);
        expect(result.error?.message).toContain("root reason");
    });
});
