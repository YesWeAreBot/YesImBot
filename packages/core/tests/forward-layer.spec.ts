import { OneBot } from "koishi-plugin-adapter-onebot";
import { expect, it, vi } from "vitest";

import InteractionsExtension from "../src/extension/builtin/interactions";
import { ForwardLayerCache } from "../src/extension/forward-layer";
import { EventListenerManager } from "../src/world/event-listener";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const root = "7697801892654501477";
const text = (text: string) => ({ type: "text", data: { text } });
const node = (...message: any[]) => ({ message_id: "node-id", sender: { user_id: 1798037526, nickname: "许仙" }, time: 1792284169, message });
it("does not evict inline children or the root while constructing one large page", async () => {
    const f = setup([node(...Array.from({ length: 150 }, (_, i) => ({ type: "node", data: node(text(`child-${i}`)) })))]);
    const page = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(page.status).toBe("success");
    const firstChild = await f.extension.getForwardMsg({ session: f.session, id: page.result.nestedForwardIds[0] });
    expect(firstChild.status).toBe("success");
    expect(firstChild.result.content).toContain("child-0");
    expect(page.result.content).toContain("内嵌内容未缓存");
    expect(page.result.content).toContain("mode=recursive");
    await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(f.api).toHaveBeenCalledTimes(1);
});
it("keeps new system faces typed in forwarded mixed messages", async () => {
    const f = setup([node(text("手打 /冤种"), { type: "face", data: { id: "99999", raw: { faceText: "/冤种", faceType: 3 } } })]);
    const page = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(page.result.content).toContain("手打 /冤种");
    expect(page.result.content).toContain('name="冤种"');
    expect(page.result.content).toContain('kind="super"');
    expect(page.result.content).not.toContain("[object Object]");
});
it("uses matching native face positions when a forwarded node contains a text fallback", async () => {
    const f = setup([{ ...node(text("/冤种")), raw: { elements: [{ faceElement: { faceIndex: 99999, faceText: "/冤种", faceType: 3 } }] } }]);
    const page = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(page.result.content).toContain('name="冤种"');
    expect(page.result.content).toContain('kind="super"');
});
function setup(payload: unknown) {
    const api = vi.fn<(id: string) => Promise<unknown>>(async (_id) => payload);
    const log = { debug() {}, info() {}, error() {} };
    const extension: any = Object.create(InteractionsExtension.prototype);
    extension.ctx = stubCtx({ asset: { transform: async (elements: any[]) => elements.join("") } }, { logger: log });
    const session: any = {
        platform: "onebot",
        selfId: "953230457",
        userId: "1798037526",
        channelId: "private:1798037526",
        isDirect: true,
        bot: { internal: { getForwardMsg: api } },
    };
    return { extension, session, api };
}
it("reads one layer through bot.internal, keeps exact IDs and reads inline children without fetching them again", async () => {
    const child = [node(text("child body"), { type: "forward", data: { id: "C", content: [node(text("grandchild"))] } })];
    const f = setup({ data: { messages: [node(text("ordinary")), node({ type: "forward", data: { id: "B", content: child } }), node(text("last"))] } });
    const first = await f.extension.getForwardMsg({ session: f.session, id: root, limit: 2 });
    expect(first.status).toBe("success");
    expect(first.result.forwardId).toBe(root);
    expect(first.result.nextOffset).toBe(2);
    expect(first.result.content).toContain('<forward id="B"/>');
    expect(JSON.stringify(first.result)).not.toContain("child body");
    expect(f.api.mock.calls.map(([id]) => id)).toEqual([root]);
    const second = await f.extension.getForwardMsg({ session: f.session, id: "B" });
    expect(JSON.stringify(second.result)).toContain("child body");
    expect(JSON.stringify(second.result)).not.toContain("grandchild");
    const third = await f.extension.getForwardMsg({ session: f.session, id: "C" });
    expect(JSON.stringify(third.result)).toContain("grandchild");
    expect(f.api).toHaveBeenCalledTimes(1);
    const tail = await f.extension.getForwardMsg({ session: f.session, id: root, offset: 2 });
    expect(tail.result.returned).toBe(1);
    expect(tail.result.hasMore).toBe(false);
    expect(JSON.stringify(tail.result)).toContain("last");
});
it("preserves the supplied outer message ID and forward resource ID through the real OneBot decoder and recording", async () => {
    const raw = {
        self_id: 953230457,
        message_id: 205361551,
        user_id: 1798037526,
        time: 1792284169,
        message_type: "private",
        sender: { user_id: 1798037526, nickname: "许仙" },
        message: [{ type: "forward", data: { id: root } }],
    };
    const message = await OneBot.adaptMessage({ config: { advanced: {} }, platform: "onebot" } as any, raw as any);
    expect(message.id).toBe("205361551");
    expect(message.content).toContain(`<forward id="${root}"/>`);
    const recorded: any[] = [];
    const log = { debug() {}, info() {}, error() {} };
    const asset = { transform: async (value: string) => value };
    const listener: any = new EventListenerManager(
        stubCtx({}) as any,
        { observeChannel: async () => {}, recordMessage: async (m: unknown) => recorded.push(m) } as any,
        {} as any,
        loggingStub(log),
        asset as any,
    );
    await listener.recordUserMessage({
        platform: "onebot",
        selfId: "953230457",
        userId: "1798037526",
        channelId: "private:1798037526",
        isDirect: true,
        messageId: message.id,
        timestamp: raw.time * 1000,
        author: { name: "许仙" },
        content: "[不支持的元素类型]",
        onebot: raw,
        toJSON: () => ({ message: { content: "[不支持的元素类型]" } }),
    });
    expect(recorded[0].id).toBe("205361551");
    expect(recorded[0].content).toContain(`<forward id="${root}"/>`);
});

it("pages every sibling without automatically fetching nested packages", async () => {
    const f = setup(Array.from({ length: 125 }, (_, i) => node(text(`row-${i};`), { type: "forward", data: { id: `child-${i}` } })));
    const contents: string[] = [];
    let offset: number | null = 0;
    do {
        const page = await f.extension.getForwardMsg({ session: f.session, id: root, offset, limit: 30 });
        expect(page.status).toBe("success");
        contents.push(page.result.content);
        offset = page.result.nextOffset;
    } while (offset !== null);
    for (let i = 0; i < 125; i++) expect(contents.join("")).toContain(`row-${i};`);
    expect(f.api).toHaveBeenCalledTimes(1);
});
it("does not reuse inline snapshots across users, channels or cleared histories and rechecks permission after IO", async () => {
    const f = setup([node({ type: "forward", data: { id: "child", content: [node(text("private child"))] } })]);
    let generation = 0,
        permitted = true;
    f.extension.ctx.yesimbot.world = { isChannelAllowed: () => permitted, l2_manager: { getHistoryGeneration: () => generation } };
    await f.extension.getForwardMsg({ session: f.session, id: root });
    f.api.mockRejectedValue(new Error("platform has no standalone child"));
    for (const session of [
        { ...f.session, userId: "other" },
        { ...f.session, channelId: "other" },
    ]) {
        const result = await f.extension.getForwardMsg({ session, id: "child" });
        expect(result.status).toBe("error");
        expect(JSON.stringify(result)).not.toContain("private child");
    }
    generation++;
    expect((await f.extension.getForwardMsg({ session: f.session, id: "child" })).status).toBe("error");
    f.api.mockImplementation(async () => {
        permitted = false;
        return [node(text("must not publish"))];
    });
    const revoked = await f.extension.getForwardMsg({ session: f.session, id: "fresh" });
    expect(revoked.status).toBe("error");
    expect(JSON.stringify(revoked)).not.toContain("must not publish");
});
it("makes anonymous inline node packages explicitly readable without pretending they have platform resource IDs", async () => {
    const f = setup([node({ type: "node", data: { name: "Other", uin: "2", content: [text("inline body")] } })]);
    const page = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(page.status).toBe("success");
    const [inlineId] = page.result.nestedForwardIds;
    expect(inlineId).toMatch(/^inline-forward:/);
    expect(page.result.content).not.toContain("inline body");
    const child = await f.extension.getForwardMsg({ session: f.session, id: inlineId });
    expect(child.result.content).toContain("inline body");
    expect(f.api).toHaveBeenCalledTimes(1);
    const changed = await f.extension.getForwardMsg({ session: { ...f.session, channelId: "other" }, id: inlineId });
    expect(changed.status).toBe("error");
    expect(f.api).toHaveBeenCalledTimes(1);
});
it("rejects unsafe numeric resource IDs instead of querying a rounded integer", async () => {
    const f = setup([]);
    expect((await f.extension.getForwardMsg({ session: f.session, id: Number(root) })).status).toBe("error");
    expect(f.api).not.toHaveBeenCalled();
});

it("keeps ordinary siblings when inline content conflicts with the parent resource", async () => {
    const f = setup([node(text("before"), { type: "forward", data: { id: root, content: [node(text("conflicting body"))] } }, text("after"))]);
    const page = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(page.status).toBe("success");
    expect(page.result.content).toContain("before");
    expect(page.result.content).toContain("after");
    expect(page.result.content).toContain("内嵌内容未缓存");
    const again = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(again.result.content).toContain("before");
    expect(again.result.content).not.toContain("conflicting body");
});

it("cache capacity never truncates horizontal content or prevents subsequent pages", async () => {
    const f = setup([node(text("first")), node(text("last"))]);
    f.extension.forwardLayers = new ForwardLayerCache(1);
    const first = await f.extension.getForwardMsg({ session: f.session, id: root, limit: 1 });
    expect(first.status).toBe("success");
    expect(first.result.snapshotCached).toBe(false);
    expect(first.result.content).toContain("first");
    const last = await f.extension.getForwardMsg({ session: f.session, id: root, offset: first.result.nextOffset, limit: 1 });
    expect(last.status).toBe("success");
    expect(last.result.content).toContain("last");
    expect(last.result.hasMore).toBe(false);
});

it("accepts the normal session.onebot API and preserves mixed media in the current layer", async () => {
    const f = setup(undefined);
    f.session.onebot = { getForwardMsg: f.api };
    f.api.mockResolvedValue({
        messages: [
            node(
                text("text"),
                { type: "image", data: { url: "https://example.invalid/image.png" } },
                { type: "video", data: { url: "https://example.invalid/video.mp4" } },
                { type: "record", data: { url: "https://example.invalid/voice.ogg" } },
                { type: "file", data: { name: "report.pdf", url: "https://example.invalid/report.pdf" } },
            ),
        ],
    });
    const page = await f.extension.getForwardMsg({ session: f.session, id: root });
    expect(page.status).toBe("success");
    for (const content of ["text", "image.png", "video.mp4", "voice.ogg", "report.pdf"]) expect(page.result.content).toContain(content);
    expect(f.api).toHaveBeenCalledWith(root);
});
it("expires inline snapshots and can recover them by rereading the parent page", async () => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
        const payload = [node({ type: "forward", data: { id: "B", content: [node(text("recoverable child"))] } })];
        const f = setup(payload);
        f.api.mockImplementation(async (id) => {
            if (id === root) return payload;
            throw new Error("no standalone child");
        });
        await f.extension.getForwardMsg({ session: f.session, id: root });
        now += 600_001;
        expect((await f.extension.getForwardMsg({ session: f.session, id: "B" })).status).toBe("error");
        expect((await f.extension.getForwardMsg({ session: f.session, id: root })).status).toBe("success");
        expect((await f.extension.getForwardMsg({ session: f.session, id: "B" })).result.content).toContain("recoverable child");
        expect(f.api).toHaveBeenCalledTimes(3);
    } finally {
        clock.mockRestore();
    }
});
