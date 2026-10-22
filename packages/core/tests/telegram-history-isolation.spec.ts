import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Bot, Context } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { TableName } from "../src/shared/constants";
import { ContextBuilder } from "../src/world/context-builder";
import { EventListenerManager } from "../src/world/event-listener";
import { InteractionManager } from "../src/world/interaction-manager";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
async function fixture() {
    const ctx = new Context();
    ctx.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx });
    await ctx.start();
    await ctx.database.prepared();
    const directory = await mkdtemp(path.join(tmpdir(), "yib-telegram-history-"));
    onTestFinished(async () => {
        await ctx.stop();
        await rm(directory, { recursive: true, force: true });
    });
    const logging = { getLogger: () => logger } as any;
    const config: any = {
        allowedChannels: [{ platform: "telegram", type: "guild", id: "*" }],
        l1_memory: { maxMessages: 100, keepFullTurnCount: 5 },
        l2_memory: { enabled: false },
        l3_memory: { enabled: false },
    };
    const l1 = new InteractionManager(ctx, config, logging);
    Object.assign(l1, { resolvedBasePath: directory });
    const l2 = new SemanticMemoryManager(ctx, config, logging, {} as any);
    const world = Object.assign(Object.create(WorldStateService.prototype), { ctx, config, l1_manager: l1, l2_manager: l2 });
    world.contextBuilder = new ContextBuilder(ctx, config, l1, l2, {} as any, logging);
    const listener = new EventListenerManager(ctx, world, config, logging, { transform: async (x: string) => x } as any);
    const bot = Object.assign(Object.create(Bot.prototype), {
        ctx,
        platform: "telegram",
        user: { id: "bot", name: "bot" },
        getSelf: async () => ({ id: "bot" }),
        getChannel: async (id: string) => ({ id }),
        getGuildMember: async () => ({ id: "bot" }),
    });
    const session = (guildId: string, id: string, content: string) =>
        bot.session({
            type: "message",
            guild: { id: guildId },
            channel: { id: "7", type: 0 },
            user: { id: "alice", name: "Alice" },
            message: { id, content },
            timestamp: Date.now(),
        });
    return { ctx, world, l1, l2, listener, session, directory };
}
for (const equalMessageIds of [false, true])
    it(`isolates Telegram topics across groups with ${equalMessageIds ? "equal" : "distinct"} message IDs`, async () => {
        const f = await fixture();
        const a = f.session("-1001", "1", "group A secret"),
            b = f.session("-1002", equalMessageIds ? "1" : "2", "group B secret");
        await (f.listener as any).recordUserMessage(a);
        await (f.listener as any).recordUserMessage(b);
        const aContext = await f.world.buildWorldState(a),
            bContext = await f.world.buildWorldState(b);
        expect(JSON.stringify(aContext)).toContain("group A secret");
        expect(JSON.stringify(aContext)).not.toContain("group B secret");
        expect(JSON.stringify(bContext)).toContain("group B secret");
        expect(JSON.stringify(bContext)).not.toContain("group A secret");
        expect((await f.world.recallContext(a, { kind: "messages" })).records.map((r: any) => r.content)).toEqual(["group A secret"]);
        expect((await f.world.recallContext(b, { kind: "messages" })).records.map((r: any) => r.content)).toEqual(["group B secret"]);
        expect(a.channelId).toBe("7");
        expect(b.channelId).toBe("7");
    });
it("quarantines ambiguous legacy topic history without modifying or copying it", async () => {
    const f = await fixture();
    await f.ctx.database.create(TableName.Messages, {
        platform: "telegram",
        channelId: "7",
        channelType: "guild",
        id: "legacy",
        sender: { id: "alice" },
        content: "ambiguous legacy secret",
        timestamp: new Date(),
    });
    const session = f.session("-1001", "new", "fresh");
    expect((await f.world.recallContext(session, { kind: "messages" })).records).toEqual([]);
    expect(JSON.stringify(await f.world.buildWorldState(session))).not.toContain("ambiguous legacy secret");
    expect(await f.ctx.database.get(TableName.Messages, { platform: "telegram" })).toHaveLength(1);
});
it("exports transport-native source identity while retaining an isolated evidence key", async () => {
    const f = await fixture();
    const a = f.session("-1001", "1", "A"),
        b = f.session("-1002", "1", "B");
    await (f.listener as any).recordUserMessage(a);
    await (f.listener as any).recordUserMessage(b);
    const wa = await f.world.readMessageWindow(a, { messageId: "1" });
    const wb = await f.world.readMessageWindow(b, { messageId: "1" });
    expect(wa.anchor.sourceIdentity).toMatchObject({ channelId: "7", guildId: "-1001", messageId: "1" });
    expect(wb.anchor.sourceIdentity).toMatchObject({ channelId: "7", guildId: "-1002", messageId: "1" });
    expect(wa.anchor.evidenceKey).not.toBe(wb.anchor.evidenceKey);
});
it("keeps L2 buffers, agent logs and history clearing inside the current topic group", async () => {
    const f = await fixture();
    const a = f.session("-1001", "1", "A chunk"),
        b = f.session("-1002", "1", "B chunk");
    (f.world as any).config.l2_memory = { enabled: true, messagesPerChunk: 2 };
    (f.l2 as any).embedModel = { embed: async () => ({ embedding: [1, 0] }) };
    await (f.listener as any).recordUserMessage(a);
    await (f.listener as any).recordUserMessage(b);
    const { conversationChannelId } = await import("../src/shared/utils/conversation-scope");
    const ak = conversationChannelId(a)!,
        bk = conversationChannelId(b)!;
    await f.l2.flushBuffer(ak, "telegram");
    await f.l2.flushBuffer(bk, "telegram");
    const chunks = await f.ctx.database.get(TableName.L2Chunks, { platform: "telegram" });
    expect(chunks).toHaveLength(2);
    expect(chunks.find((r) => r.channelId === ak)?.content).toContain("A chunk");
    expect(chunks.find((r) => r.channelId === ak)?.content).not.toContain("B chunk");
    expect(chunks.find((r) => r.channelId === bk)?.content).toContain("B chunk");
    await f.l1.recordObservation("a-log", "telegram", ak, { turnId: "a", function: "test", status: "success", result: "A log" });
    await f.l1.recordObservation("b-log", "telegram", bk, { turnId: "b", function: "test", status: "success", result: "B log" });
    const logFiles = await readdir(path.join(f.directory, "telegram"));
    expect(logFiles.every((name) => !/[<>:"\\|?*]/.test(name))).toBe(true);
    expect(JSON.stringify(await f.world.buildWorldState(a))).not.toContain("B log");
    expect(JSON.stringify(await f.world.buildWorldState(b))).not.toContain("A log");
    await f.l2.clearHistory({ platform: "telegram", channelId: ak }, async () => {
        await f.ctx.database.remove(TableName.Messages, { platform: "telegram", channelId: ak });
        await f.ctx.database.remove(TableName.L2Chunks, { platform: "telegram", channelId: ak });
        await f.l1.clearAgentHistory("telegram", ak);
    });
    expect((await f.world.recallContext(a, { kind: "messages" })).records).toHaveLength(0);
    expect((await f.world.recallContext(b, { kind: "messages" })).records).toHaveLength(1);
    expect((await f.world.recallContext(b, { kind: "l2" })).records).toHaveLength(1);
    expect(JSON.stringify(await f.world.buildWorldState(b))).toContain("B log");
});
it("preserves native main-group and direct identities and decodes only Telegram topic identities", async () => {
    const { conversationChannelId, conversationCid, parseConversationChannelId } = await import("../src/shared/utils/conversation-scope");
    expect(conversationChannelId({ platform: "telegram", channelId: "-1001", guildId: "-1001", isDirect: false })).toBe("-1001");
    expect(conversationChannelId({ platform: "telegram", channelId: "7", guildId: "-1001", isDirect: true })).toBe("7");
    expect(conversationChannelId({ platform: "onebot", channelId: "7", guildId: "-1001", isDirect: false })).toBe("7");
    expect(conversationChannelId({ platform: "telegram" })).toBeUndefined();
    const topic = { platform: "telegram", channelId: "7", guildId: "-1001", isDirect: false };
    const key = conversationChannelId(topic)!;
    expect(conversationCid(topic)).toBe(`telegram:${key}`);
    expect(parseConversationChannelId("telegram", key)).toEqual({ guildId: "-1001", channelId: "7" });
    expect(parseConversationChannelId("onebot", key)).toEqual({ channelId: key });
    for (const malformed of ["telegram-topic:bad", "telegram-topic:[]", 'telegram-topic:["a",3]', 'telegram-topic:["", "b"]'])
        expect(parseConversationChannelId("telegram", malformed)).toEqual({ channelId: malformed });
});
it("isolates automatic L3 context and raw summary recall from legacy and other groups", async () => {
    const f = await fixture();
    const { conversationChannelId } = await import("../src/shared/utils/conversation-scope");
    const { diaryDateKey } = await import("../src/world/memory-date");
    const a = f.session("-1001", "1", "A"),
        b = f.session("-1002", "2", "B");
    f.world.config.l3_memory = { enabled: true, messageThreshold: 1 };
    for (const [id, channelId, content] of [
        ["a", conversationChannelId(a)!, "A diary"],
        ["b", conversationChannelId(b)!, "B diary"],
        ["old", "7", "legacy diary"],
    ])
        await f.ctx.database.create(TableName.L3Diaries, { id, platform: "telegram", channelId, date: diaryDateKey(new Date()), content, keywords: [] });
    const context = JSON.stringify(await f.world.buildWorldState(a));
    expect(context).toContain("A diary");
    expect(context).not.toContain("B diary");
    expect(context).not.toContain("legacy diary");
    expect((await f.world.recallContext(a, { kind: "l3" })).records.map((r: any) => r.content)).toEqual(["A diary"]);
    expect((await f.world.recallContext(b, { kind: "l3" })).records.map((r: any) => r.content)).toEqual(["B diary"]);
});
