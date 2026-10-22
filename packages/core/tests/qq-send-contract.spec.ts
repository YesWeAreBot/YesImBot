import { Bot, Context, h, MessageEncoder, Universal } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import CoreUtilExtension from "../src/extension/builtin/core-util";

// Routing contracts: satorijs/satori 4c68dc2 (QQ 4.7.5), 7606a0c (QQ 4.14.0),
// koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack c24d4aa.
// External API calls terminate locally; encoding uses the installed Koishi lifecycle.
async function fixture(family: "legacy" | "current" | "crack") {
    const ctx = new Context();
    const requests: any[] = [];
    class Encoder extends MessageEncoder {
        private content = "";
        async visit(element: h) {
            this.content += element.toString();
        }
        async flush() {
            if (!this.content) return;
            const source = this.options.session;
            const data: any = { content: this.content };
            if (source?.messageId) {
                data.msg_id = source.messageId;
                data.msg_seq = source["seq"] = (source["seq"] || 0) + 1;
            } else if (family === "legacy") {
                // QQ 4.7.5 reads qq['id'] without optional chaining on qq.
                data.event_id = source?.["qq"]["id"];
            }
            const direct = this.session.isDirect || (family === "crack" && this.channelId.startsWith("private:"));
            const media = h.select(h.parse(this.content), "img").length > 0;
            const uploadTarget = media && family === "legacy" ? (direct ? source?.event.message?.user?.id : this.session.guildId) : undefined;
            if (media && family === "legacy" && !uploadTarget) throw new Error("missing media destination");
            requests.push({
                endpoint: direct ? "private" : "group",
                target: family === "crack" && direct ? this.channelId.replace(/^private:/, "") : this.channelId,
                uploadTarget,
                data,
            });
            this.results.push({ id: `sent-${requests.length}` });
            this.content = "";
        }
    }
    class QQBot extends Bot {
        static MessageEncoder = Encoder;
        constructor() {
            super(ctx, {} as any, "qq");
            this.user = { id: "bot", name: "bot" };
        }
        async createDirectChannel(id: string) {
            return { id: family === "crack" ? `private:${id}` : id, type: Universal.Channel.Type.DIRECT };
        }
    }
    const bot = new QQBot();
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    ctx.set("yesimbot", { logging: { getLogger: () => logger }, asset: { encode: async (text: string) => text } } as any);
    const tool = new CoreUtilExtension(ctx, { typing: { baseDelay: 0, minDelay: 0, maxDelay: 0, charPerSecond: 5 } } as any);
    const session = bot.session({
        type: "message",
        channel: { id: "origin", type: Universal.Channel.Type.TEXT },
        guild: { id: "origin" },
        user: { id: "sender" },
        message: { id: "incoming", user: { id: "sender" } },
    });
    session.setInternal("qq", {});
    await ctx.start();
    onTestFinished(() => ctx.stop());
    return { bot, tool, session, requests };
}

for (const family of ["legacy", "current", "crack"] as const) {
    it(`routes proactive text and image to the resolved ${family} private recipient`, async () => {
        const f = await fixture(family);
        const result = await f.tool.sendMessage({
            session: f.session,
            target: "qq:recipient",
            target_type: "private",
            message: 'hello<img src="data:image/png;base64,cG5n"/>',
        } as any);
        expect(result.status).toBe("success");
        expect(f.requests).toHaveLength(1);
        expect(f.requests[0]).toMatchObject({ endpoint: "private", target: "recipient" });
        expect(f.requests[0].data.msg_id).toBeUndefined();
        expect(f.requests[0].data.msg_seq).toBeUndefined();
        expect(f.requests[0].data.event_id).toBeUndefined();
        if (family === "legacy") expect(f.requests[0].uploadTarget).toBe("recipient");
    });

    it(`does not inherit a private source when retargeting a ${family} group image`, async () => {
        const f = await fixture(family);
        f.session.isDirect = true;
        const result = await f.tool.sendMessage({ session: f.session, target: "qq:other-group", message: '<img src="data:image/png;base64,cG5n"/>' } as any);
        expect(result.status).toBe("success");
        expect(f.requests[0]).toMatchObject({ endpoint: "group", target: "other-group" });
        expect(f.requests[0].data.msg_id).toBeUndefined();
        if (family === "legacy") expect(f.requests[0].uploadTarget).toBe("other-group");
    });

    it(`reuses the original ${family} passive sequence across tool calls`, async () => {
        const f = await fixture(family);
        for (const text of ["first", "second"]) expect((await f.tool.sendMessage({ session: f.session, message: text } as any)).status).toBe("success");
        expect(f.requests.map((request) => request.data.msg_id)).toEqual(["incoming", "incoming"]);
        expect(f.requests.map((request) => request.data.msg_seq)).toEqual([1, 2]);
        expect(f.session["seq"]).toBe(2);
    });
    it(`preserves the original ${family} private session and passive sequence`, async () => {
        const f = await fixture(family);
        const channel = await f.bot.createDirectChannel("sender");
        f.session.event.channel = channel;
        f.session.event.guild = undefined;
        for (const text of ["first", "second"]) {
            const result = await f.tool.sendMessage({ session: f.session, target: `qq:${channel.id}`, message: text } as any);
            expect(result.status).toBe("success");
        }
        expect(f.requests.map((request) => request.endpoint)).toEqual(["private", "private"]);
        expect(f.requests.map((request) => request.target)).toEqual(["sender", "sender"]);
        expect(f.requests.map((request) => request.data.msg_id)).toEqual(["incoming", "incoming"]);
        expect(f.requests.map((request) => request.data.msg_seq)).toEqual([1, 2]);
        expect(f.session["seq"]).toBe(2);
    });
}
