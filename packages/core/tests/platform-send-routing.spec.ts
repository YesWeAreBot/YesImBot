import { Bot, Context, h, MessageEncoder, Universal } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import CoreUtilExtension from "../src/extension/builtin/core-util";

// satorijs/satori v4 encoder contracts: Telegram prepare, Slack quote,
// Lark referrer and quote, Discord native thread channels, KOOK chat codes.
async function fixture(platform: string) {
    const ctx = new Context();
    const requests: any[] = [];
    const receipts: any[] = [];
    class Encoder extends MessageEncoder {
        private elements: h[] = [];
        async visit(element: h) {
            this.elements.push(element);
        }
        async flush() {
            if (!this.elements.length) return;
            const quote = h.select(this.elements, "quote")[0];
            const referrer = this.referrer as any;
            requests.push({
                channel: this.channelId,
                guild: this.session.guildId,
                direct: this.session.isDirect,
                chat_id: this.session.guildId || this.channelId,
                message_thread_id: this.session.guildId && this.channelId !== this.session.guildId ? this.channelId : undefined,
                thread_ts: quote?.attrs.id,
                lark_reply: quote?.attrs.id ?? (referrer?.event?.message?.thread_id ? referrer.event.message.message_id : undefined),
                lark_in_thread: quote?.attrs.replyInThread ?? !!referrer?.event?.message?.thread_id,
                elements: this.elements.map((element) => element.toString()),
                sourceMessageId: this.options.session?.messageId,
            });
            this.results.push({ id: `sent-${requests.length}` });
            this.elements = [];
        }
    }
    class AdapterBot extends Bot {
        static MessageEncoder = Encoder;
        constructor() {
            super(ctx, {} as any, platform);
            this.user = { id: "bot" };
        }
        async createDirectChannel(user: string) {
            return { id: `${platform}-dm-${user}`, type: Universal.Channel.Type.DIRECT };
        }
    }
    const bot = new AdapterBot();
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    ctx.set("yesimbot", { logging: { getLogger: () => log }, asset: { encode: async (value: string) => value } } as any);
    const tool = new CoreUtilExtension(ctx, { typing: { baseDelay: 0, minDelay: 0, maxDelay: 0, charPerSecond: 5 } } as any);
    const session = bot.session({
        type: "message",
        channel: { id: "channel", type: 0 },
        guild: { id: "guild" },
        user: { id: "user" },
        message: { id: "incoming" },
    });
    ctx.on("after-send", (event) => {
        receipts.push(event.toJSON());
    });
    await ctx.start();
    onTestFinished(() => ctx.stop());
    return { bot, session, tool, requests, receipts };
}

it("preserves the current Telegram topic and original quote/media elements", async () => {
    const f = await fixture("telegram");
    f.session.channelId = "7";
    f.session.guildId = "-100001";
    const message = '<quote id="43"/>hello<img src="data:image/png;base64,cG5n"/><audio src="data:audio/ogg;base64,YQ=="/>';
    expect((await f.tool.sendMessage({ session: f.session, message } as any)).status).toBe("success");
    expect(f.requests[0]).toMatchObject({ channel: "7", chat_id: "-100001", message_thread_id: "7", sourceMessageId: "incoming" });
    expect(f.requests[0].elements.join("")).toBe(message);
});

it("routes a Telegram topic in another chat without borrowing the current chat", async () => {
    const f = await fixture("telegram");
    f.session.channelId = "7";
    f.session.guildId = "-100001";
    expect((await f.tool.sendMessage({ session: f.session, target: "telegram:7", guild_id: "-100002", message: "hello" } as any)).status).toBe("success");
    expect(f.requests[0]).toMatchObject({ channel: "7", chat_id: "-100002", message_thread_id: "7" });
    expect(f.requests[0].sourceMessageId).toBeUndefined();
    expect(f.receipts[0].guild.id).toBe("-100002");
    expect(f.session.guildId).toBe("-100001");
});

it("routes another Telegram topic in its explicit parent chat", async () => {
    const f = await fixture("telegram");
    expect((await f.tool.sendMessage({ session: f.session, target: "telegram:9", guild_id: "-100002", message: "hello" } as any)).status).toBe("success");
    expect(f.requests[0]).toMatchObject({ channel: "9", chat_id: "-100002", message_thread_id: "9" });
});

it("continues a Slack thread when the incoming adapter quote identifies its parent", async () => {
    const f = await fixture("slack");
    f.session.event.message!.quote = { id: "1700.001" };
    expect((await f.tool.sendMessage({ session: f.session, message: 'hello<img src="data:image/png;base64,cG5n"/>' } as any)).status).toBe("success");
    expect(f.requests[0].thread_ts).toBe("1700.001");
});

it("keeps an explicit Slack quote ahead of inferred thread context", async () => {
    const f = await fixture("slack");
    f.session.event.message!.quote = { id: "1700.001" };
    expect((await f.tool.sendMessage({ session: f.session, message: '<quote id="1800.001"/>hello' } as any)).status).toBe("success");
    expect(f.requests[0].thread_ts).toBe("1800.001");
});

it("does not move a Slack send to another channel into the source thread", async () => {
    const f = await fixture("slack");
    f.session.event.message!.quote = { id: "1700.001" };
    expect((await f.tool.sendMessage({ session: f.session, target: "slack:other", message: "hello" } as any)).status).toBe("success");
    expect(f.requests[0].thread_ts).toBeUndefined();
    expect(f.requests[0].sourceMessageId).toBeUndefined();
});

it("preserves the native Lark thread referrer for the current conversation", async () => {
    const f = await fixture("lark");
    f.session.event.referrer = { type: "im.message.receive_v1", event: { message: { thread_id: "thread", message_id: "anchor" } } };
    expect((await f.tool.sendMessage({ session: f.session, message: "hello" } as any)).status).toBe("success");
    expect(f.requests[0]).toMatchObject({ lark_reply: "anchor", lark_in_thread: true });
    expect((await f.tool.sendMessage({ session: f.session, target: "lark:other", message: "hello" } as any)).status).toBe("success");
    expect(f.requests[1].lark_reply).toBeUndefined();
});

it("preserves an explicit Lark thread quote", async () => {
    const f = await fixture("lark");
    expect((await f.tool.sendMessage({ session: f.session, message: '<quote id="anchor" replyInThread="true"/>hello' } as any)).status).toBe("success");
    expect(f.requests[0]).toMatchObject({ lark_reply: "anchor", lark_in_thread: "true" });
});

for (const platform of ["discord", "kook"]) {
    it(`keeps ${platform} native destinations and private channel metadata`, async () => {
        const f = await fixture(platform);
        expect(
            (
                await f.tool.sendMessage({
                    session: f.session,
                    target: `${platform}:native-thread`,
                    guild_id: "server",
                    message: '<quote id="source"/>hello<file src="https://files.invalid/file"/>',
                } as any)
            ).status,
        ).toBe("success");
        expect(f.requests[0]).toMatchObject({ channel: "native-thread", guild: "server" });
        expect(f.requests[0].elements.join("")).toContain('<quote id="source"/>');
        expect((await f.tool.sendMessage({ session: f.session, target: `${platform}:user`, target_type: "private", message: "hello" } as any)).status).toBe(
            "success",
        );
        expect(f.requests[1]).toMatchObject({ channel: `${platform}-dm-user`, direct: true });
    });
}
