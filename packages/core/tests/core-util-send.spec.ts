import { Bot, Context, MessageEncoder, h } from "koishi";
import { describe, expect, it } from "vitest";

import { withReplyTurn } from "../src/agent/reply-turn";
import CoreUtilExtension from "../src/extension/builtin/core-util";
import { MessageDeliveryError } from "../src/shared/message-delivery";

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
        yesimbot: {
            logging: { getLogger: () => logger },
            asset: { encode: async (message: string) => message },
        },
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
            expect(calls[0].slice(0, 2)).toEqual([target.split(":").slice(1).join(":"), "hello"]);
            expect(calls[0][3]?.session).not.toBe(session);
            expect(calls[0][3]?.session?.messageId).toBeUndefined();
            expect(calls[0][2]).toBeUndefined();
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

    it("retains HTTP status and QQ error details without serializing request credentials", async () => {
        const error = Object.assign(new Error("request failed"), {
            code: "ERR_BAD_RESPONSE",
            response: { status: 400, data: { code: 40054005, message: "duplicate sequence", trace_id: "qq-trace" }, headers: { authorization: "secret" } },
            config: { headers: { Authorization: "secret" } },
        });
        const { tool, session } = setup(async () => {
            throw error;
        });
        const result = await tool.sendMessage({ session, message: "hello" } as any);
        expect(result.error?.message).toContain("40054005");
        expect(result.error?.message).toContain("duplicate sequence");
        expect(result.error?.message).toContain("400");
        expect(result.error?.message).toContain("qq-trace");
        expect(result.error?.message).not.toContain("secret");
    });

    it("does not accept empty message IDs as confirmed delivery", async () => {
        const { tool, session, events } = setup(async () => [""]);
        expect((await tool.sendMessage({ session, message: "hello" } as any)).status).toBe("error");
        expect(events).toEqual([]);
    });

    it("records encoder-confirmed messages even when the same send rejects", async () => {
        const { tool, session, events } = setup(async () => {
            throw new MessageDeliveryError(new AggregateError([new Error("image refused")]), [{ id: "text-sent", content: "text only" }]);
        });
        const result = await tool.sendMessage({ session, message: 'text only<img src="file:///image.png"/>' } as any);
        expect(result.status).toBe("error");
        expect(result.error?.message).toContain("image refused");
        expect(result.error?.retryable).toBe(false);
        expect(result.metadata?.delivery.messageIds).toEqual(["text-sent"]);
        expect(events).toHaveLength(1);
        expect(events[0][1].event.message).toMatchObject({ id: "text-sent", content: "text only" });
    });

    it("does not record the full attempted body when a partial encoder receipt has no content", async () => {
        const { tool, session, events } = setup(async () => {
            throw new MessageDeliveryError(new Error("image refused"), [{ id: "text-sent" }]);
        });
        const result = await tool.sendMessage({ session, message: 'text<img src="file:///not-sent.png"/>' } as any);
        expect(result.metadata?.delivery.messageIds).toEqual(["text-sent"]);
        expect(events[0][1].event.message.content).toBe("");
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
        expect(calls).toHaveLength(1);
        expect(calls[0].slice(0, 2)).toEqual(["group", "hello"]);
        expect(calls[0][3]?.session).not.toBe(session);
        expect(calls[0][3]?.session?.messageId).toBeUndefined();
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
        expect(result.metadata?.delivery).toMatchObject({ messageIds: ["first-sent"], sentMessages: 1, totalMessages: 3 });
        expect(result.error?.retryable).toBe(false);
        expect(result.error?.message).toContain("已完整发送 1/3 段");
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

describe("send_message adapter routing", () => {
    it("keeps the current account for another channel on the same platform", async () => {
        const calls: string[] = [];
        const f = setup(async () => {
            calls.push("current");
            return ["sent"];
        });
        f.ctx.bots.unshift({
            ...f.bot,
            selfId: "first-bot",
            sendMessage: async () => {
                calls.push("first");
                return ["wrong"];
            },
        });
        const result = await f.tool.sendMessage({ session: f.session, message: "hello", target: "qq:other" } as any);
        expect(result.status).toBe("success");
        expect(calls).toEqual(["current"]);
    });

    it("rejects an ambiguous platform instead of selecting its first account", async () => {
        let sent = 0;
        const f = setup();
        for (const selfId of ["a", "b"])
            f.ctx.bots.push({
                ...f.bot,
                platform: "discord",
                selfId,
                sendMessage: async () => {
                    sent++;
                    return ["sent"];
                },
            });
        const result = await f.tool.sendMessage({ session: f.session, message: "hello", target: "discord:channel" } as any);
        expect(result.status).toBe("error");
        expect(result.error?.message).toMatch(/self_id|多个/);
        expect(sent).toBe(0);
    });

    it("selects an explicitly named account without borrowing another account's passive context", async () => {
        const calls: any[] = [];
        const f = setup();
        f.ctx.bots.push({
            ...f.bot,
            selfId: "second-bot",
            sendMessage: async (...args: any[]) => {
                calls.push(args);
                return ["sent"];
            },
        });
        const result = await f.tool.sendMessage({ session: f.session, message: "hello", self_id: "second-bot" } as any);
        expect(result.status).toBe("success");
        expect(calls).toHaveLength(1);
        expect(calls[0].slice(0, 2)).toEqual(["group", "hello"]);
        expect(calls[0][3]?.session).not.toBe(f.session);
        expect(calls[0][3]?.session?.messageId).toBeUndefined();
    });

    it("does not fall back to a different account when an explicit account is unavailable", async () => {
        let sent = 0;
        const f = setup(async () => {
            sent++;
            return ["sent"];
        });
        const result = await f.tool.sendMessage({ session: f.session, message: "hello", target: "qq:other", self_id: "missing" } as any);
        expect(result.status).toBe("error");
        expect(sent).toBe(0);
    });

    for (const target of ["qq:", ":channel", "qq"]) {
        it(`rejects malformed destination ${target}`, async () => {
            let sent = 0;
            const f = setup(async () => {
                sent++;
                return ["sent"];
            });
            expect((await f.tool.sendMessage({ session: f.session, message: "hello", target } as any)).status).toBe("error");
            expect(sent).toBe(0);
        });
    }

    for (const nativeId of ["recipient", "private:recipient"]) {
        it(`uses the adapter's private channel ${nativeId} and direct routing metadata`, async () => {
            const calls: any[] = [];
            const f = setup(async (...args) => {
                calls.push(args);
                return ["sent"];
            });
            f.session.messageId = "incoming-group";
            f.session.seq = 4;
            f.bot.createDirectChannel = async (userId: string) => {
                expect(userId).toBe("recipient");
                return { id: nativeId, type: 1 };
            };
            const result = await f.tool.sendMessage({
                session: f.session,
                message: '<quote id="source"/>hello',
                target: "qq:recipient",
                target_type: "private",
            } as any);
            expect(result.status).toBe("success");
            expect(calls[0][0]).toBe(nativeId);
            expect(calls[0][1]).toBe('<quote id="source"/>hello');
            const route = calls[0][3]?.session;
            expect(route.event.channel).toMatchObject({ id: nativeId, type: 1 });
            expect(route.messageId).toBeUndefined();
            expect(route.seq).toBeUndefined();
            expect(f.session.seq).toBe(4);
            expect(f.events[0][1].event.channel).toMatchObject({ id: nativeId, type: 1 });
        });
    }

    it("keeps a private session private even when the adapter has no channel type metadata", async () => {
        const f = setup();
        f.session.channelId = "raw-user-id";
        f.session.isDirect = true;
        f.session.event.channel = { id: "raw-user-id" };
        expect((await f.tool.sendMessage({ session: f.session, message: "hello" } as any)).status).toBe("success");
        expect(f.events[0][1].event.channel.type).toBe(1);
    });

    it("records every returned message ID once for a split adapter response", async () => {
        const f = setup(async () => ["text-part", "image-part", "text-part"]);
        expect((await f.tool.sendMessage({ session: f.session, message: "hello" } as any)).status).toBe("success");
        expect(f.events.map((event) => event[1].event.message.id)).toEqual(["text-part", "image-part"]);
    });
});

it("preserves the direct destination category when resolving a private tool target", async () => {
    const f = setup();
    f.bot.createDirectChannel = async () => ({ id: "recipient", type: 1 });
    const result = await withReplyTurn(
        () => true,
        () => f.tool.sendMessage({ session: f.session, target: "qq:recipient", target_type: "private", message: "hello" } as any),
        undefined,
        (target) => target.isDirect === true,
    );
    expect(result.status).toBe("success");
});

for (const guarded of [false, true]) {
    it(`records successful encoder split content with reply guard ${guarded}`, async () => {
        const ctx = new Context();
        class Encoder extends MessageEncoder {
            async visit() {
                this.results.push({ id: "text", content: "hello" }, { id: "image", elements: [h.image("https://test.invalid/a.png")] });
            }
            async flush() {}
        }
        class SendingBot extends Bot {
            static MessageEncoder = Encoder;
        }
        const bot = new SendingBot(ctx, {} as any, "slack");
        bot.user = { id: "bot" };
        const f = setup();
        f.ctx.bots = [bot];
        const session = bot.session({ channel: { id: "C", type: 0 }, message: { id: "source" } });
        const send = () => f.tool.sendMessage({ session, message: "hello" } as any);
        const result = guarded ? await withReplyTurn(() => true, send) : await send();
        expect(result.status).toBe("success");
        expect(f.events.map((event) => event[1].event.message)).toMatchObject([
            { id: "text", content: "hello" },
            { id: "image", content: '<img src="https://test.invalid/a.png"/>' },
        ]);
        await ctx.stop();
    });
}

it("leaves split receipt content unknown when an adapter returns only IDs", async () => {
    const f = setup(async () => ["text", "image"]);
    expect((await f.tool.sendMessage({ session: f.session, message: 'hello<img src="https://test.invalid/a.png"/>' } as any)).status).toBe("success");
    expect(f.events.map((event) => event[1].event.message.content)).toEqual(["", ""]);
});
