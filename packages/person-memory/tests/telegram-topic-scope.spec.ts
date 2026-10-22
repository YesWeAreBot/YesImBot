import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import pluginMock from "@koishijs/plugin-mock";
import { test } from "vitest";

import { evidenceRoot } from "../src/claims";
import { ContinuityStore, registerContinuityModels, sourceRef } from "../src/continuity";
import { summarySourceAllowed } from "../src/source-policy";
import { accountRef, mindScope, PersonStore, registerModels, sceneKey, type Evidence } from "../src/store";
import { fixture } from "./helpers";

const mock = (pluginMock as any).default ?? pluginMock;
const topic = { platform: "telegram", selfId: "bot", channelId: "42", guildId: "-1001", userId: "u", isDirect: false };
const expectedScene = (s: typeof topic) =>
    createHash("sha256")
        .update(JSON.stringify([s.platform, s.selfId, "channel", `telegram-topic:${JSON.stringify([s.guildId, s.channelId])}`]))
        .digest("hex");

test("local topic scenes and source references distinguish identical topic and message IDs in different guilds", async (t) => {
    const app = await fixture(t, registerModels);
    const people = new PersonStore(app.database, "review");
    const other = { ...topic, guildId: "-1002" };
    assert.equal(sceneKey(topic), expectedScene(topic));
    assert.notEqual(sceneKey(topic), sceneKey(other));
    assert.notEqual(sourceRef(topic, "m"), sourceRef(other, "m"));
    const identity = await people.recognize(sceneKey(topic), "u", "Alice");
    await people.capture(sceneKey(topic), { id: "m", userId: "u", name: "Alice", text: "first topic", timestamp: 1 });
    assert.equal(await people.find(sceneKey(other), identity.person.id), undefined);
    assert.deepEqual(await people.sources(sceneKey(other), "u"), []);
    const legacy = { ...topic, guildId: undefined };
    assert.notEqual(sceneKey(topic), sceneKey(legacy));
});

for (const shared of [false, true]) {
    test(`topic source permission reconstruction retains native guild and rejects forged provenance (shared=${shared})`, async (t) => {
        let adapter;
        const app = await fixture(t, (ctx) => {
            adapter = ctx.plugin(mock);
        });
        t.onTestFinished(() => adapter.dispose());
        const bot = app.bots[0];
        bot.platform = "telegram";
        const native = { ...topic, selfId: bot.selfId };
        const scopeOf = shared ? (s) => mindScope(s, "domain") : sceneKey;
        const scope = shared ? scopeOf(native) : expectedScene(native);
        const evidence: Evidence = {
            id: "m",
            userId: shared ? accountRef("telegram", "u") : "u",
            name: "Alice",
            text: "topic source",
            timestamp: 1,
            provenance: { ...native, scene: expectedScene(native), messageId: "m", personId: "p", accountRevision: 0 },
        };
        const allowed = (s) => s.channelId === native.channelId && s.guildId === native.guildId && !s.isDirect && s.userId === native.userId;
        assert.equal(summarySourceAllowed(app, evidence, scope, shared, allowed, scopeOf), true);
        for (const forged of [{ guildId: "-1002" }, { guildId: undefined }, { channelId: 'telegram-topic:["-1001","42"]' }]) {
            assert.equal(
                summarySourceAllowed(app, { ...evidence, provenance: { ...evidence.provenance!, ...forged } }, scope, shared, allowed, scopeOf),
                false,
            );
        }
        assert.equal(
            summarySourceAllowed(app, evidence, scope, shared, () => false, scopeOf),
            false,
        );
    });
}

test("shared continuity recall excludes other guilds and unqualified legacy topic records", async (t) => {
    const app = await fixture(t, (ctx) => {
        registerModels(ctx);
        registerContinuityModels(ctx);
    });
    const people = new PersonStore(app.database, "review");
    const memories = new ContinuityStore(app.database, people);
    const scope = mindScope(topic);
    const identity = await people.recognize(scope, accountRef("telegram", "u"), "Alice");
    for (const [guildId, text] of [
        [undefined, "legacy travel"],
        ["-1001", "first travel"],
        ["-1002", "second travel"],
    ]) {
        await memories.capture(scope, { ...topic, guildId }, { id: "m", userId: "u", name: "Alice", text: text!, timestamp: 1 }, identity);
    }
    assert.equal((await memories.scenes(scope)).length, 3);
    const legacy = (await app.database.get("person_memory.experiences", {})).find((row) => !row.guildId)!;
    await app.database.set("person_memory.experiences", { id: legacy.id }, { guildId: topic.guildId });
    const result = await memories.recall(scope, { query: "travel", targets: [topic] });
    assert.deepEqual(
        result.items.map((x) => x.content),
        ["first travel"],
    );
    assert.equal(result.items[0].channelId, "42");
    assert.equal(result.items[0].guildId, "-1001");
});

test("shared runtime retains separate topic targets and uses qualified world recall lookup keys", async (t) => {
    const { applySharedMemory } = await import("../src/shared-runtime");
    const tools = new Map<string, any>();
    const lookups: any[] = [];
    let permittedGuild: string | undefined;
    const app = await fixture(t, (ctx) => {
        Object.defineProperty(ctx, "bots", {
            value: [
                {
                    platform: "telegram",
                    selfId: "bot",
                    session: (event) => ({
                        ...event,
                        channelId: event.channel.id,
                        guildId: event.guild?.id,
                        userId: event.userId,
                        isDirect: event.channel.type === 1,
                    }),
                },
            ],
        });
        ctx.set("yesimbot", {
            world: {
                isChannelAllowed: (session) => !permittedGuild || session.guildId === permittedGuild,
                recallMemory: async (args) => {
                    lookups.push(args.targets);
                    return args.targets.map((x) => ({ ...x, participants: [], timestamp: 1, content: `summary ${x.channelId}` }));
                },
            },
            prompt: { inject: () => () => {} },
            tool: {
                registerTool: (tool) => {
                    tools.set(tool.name, tool);
                    return () => {};
                },
                unregisterTool: () => {},
            },
        });
        ctx.plugin({
            inject: ["database", "yesimbot"],
            apply: (ctx) =>
                applySharedMemory(ctx, {
                    mode: "review",
                    modelGroup: "",
                    summaryThreshold: 6,
                    cooldownSeconds: 600,
                    timeoutSeconds: 30,
                    maxQueue: 32,
                    recallScope: "mind",
                }),
        });
    });
    for (const guildId of ["-1001", "-1002"]) {
        await app.parallel("yesimbot/before-user-stimulus", {
            ...topic,
            guildId,
            messageId: "m",
            content: `travel ${guildId}`,
            timestamp: 1,
            author: { name: "Alice" },
        });
    }
    const result = await tools.get("person_recall").execute({ session: topic, query: "travel", limit: 6 });
    assert.equal(result.status, "success");
    assert.deepEqual(new Set(result.result.sources.map((x) => x.guildId)), new Set(["-1001", "-1002"]));
    const expected = ["-1001", "-1002"].map((guildId) => `telegram-topic:${JSON.stringify([guildId, "42"])}`);
    assert.deepEqual(new Set(lookups[0].map((x) => x.channelId)), new Set(expected));
    assert.deepEqual(new Set(result.result.summaries.map((x) => x.channelId)), new Set(expected));
    permittedGuild = "-1001";
    const restricted = await tools.get("person_recall").execute({ session: topic, query: "travel", limit: 6 });
    assert.equal(restricted.status, "success");
    assert.deepEqual(
        restricted.result.sources.map((x) => x.guildId),
        ["-1001"],
    );
    assert.deepEqual(
        restricted.result.summaries.map((x) => x.channelId),
        [expected[0]],
    );
});

test("ordinary group and private scene hashes retain their existing format", () => {
    for (const s of [
        { ...topic, channelId: topic.guildId },
        { ...topic, isDirect: true },
        { ...topic, platform: "discord" },
    ]) {
        const expected = createHash("sha256")
            .update(JSON.stringify([s.platform, s.selfId, s.isDirect ? "private" : "channel", s.isDirect ? s.userId : s.channelId]))
            .digest("hex");
        assert.equal(sceneKey(s), expected);
    }
});

test("topic evidence roots distinguish guilds while deduplicating bot observers", () => {
    const evidence = { userId: "u", id: "m", provenance: { ...topic, messageId: "m" } } as Evidence;
    assert.notEqual(evidenceRoot(evidence), evidenceRoot({ ...evidence, provenance: { ...evidence.provenance!, guildId: "-1002" } }));
    assert.equal(evidenceRoot(evidence), evidenceRoot({ ...evidence, provenance: { ...evidence.provenance!, selfId: "other-bot" } }));
});
