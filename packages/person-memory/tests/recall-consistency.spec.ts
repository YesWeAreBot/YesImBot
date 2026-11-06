import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

import { MustacheRenderer } from "../../core/src/prompt/renderer";
import { applySharedMemory } from "../src/shared-runtime";
import { PersonStore, accountRef, mindScope } from "../src/store";
import { fixture } from "./helpers";

const defaults = { mode: "review", modelGroup: "", summaryThreshold: 6, cooldownSeconds: 600, timeoutSeconds: 30, maxQueue: 32 };
const session = { platform: "onebot", selfId: "bot", channelId: "g", userId: "admin", isDirect: false };
async function runtime(t, config = {}) {
    let injection;
    const tools = new Map();
    const app = await fixture(t, (ctx) => {
        Object.defineProperty(ctx, "bots", {
            value: [
                {
                    platform: "onebot",
                    selfId: "bot",
                    session: (event) => ({ ...event, channelId: event.channel.id, isDirect: event.channel.type === 1, userId: event.userId }),
                },
            ],
        });
        ctx.model.extend("saved_observations", { id: "string", event: "json" }, { primary: "id" });
        ctx.set("yesimbot", {
            world: { isChannelAllowed: (s) => (config.allow ? config.allow(s) : true) },
            tool: {
                registerTool: (tool) => {
                    tools.set(tool.name, tool);
                    return () => tools.delete(tool.name);
                },
                unregisterTool: (name) => tools.delete(name),
            },
            prompt: {
                inject: (_name, _priority, fn) => {
                    injection = fn;
                    return () => {};
                },
            },
        });
        ctx.plugin({
            inject: ["database", "yesimbot"],
            apply: (ctx) => applySharedMemory(ctx, { ...defaults, ...config }),
        });
    });
    return { app, tools, inject: (view) => injection(view) };
}

test("automatic recall keeps its 4000 character budget while explicit recall and stored sources remain complete", async (t) => {
    const { app, tools, inject } = await runtime(t, { automaticRecall: true, recallScope: "current" });
    const content = "昨天旅行 " + "甲".repeat(12000) + "完整结尾";
    await app.parallel("yesimbot/before-user-stimulus", { ...session, messageId: "long", content, timestamp: Date.now(), author: { name: "Alice" } });
    const explicit = await tools.get("person_recall").execute({ session, query: "昨天旅行", limit: 4 });
    assert.equal(explicit.status, "success");
    assert.equal(explicit.result.sources[0].content, content);
    assert.equal((await app.database.get("person_memory.experiences", {}))[0].content, content);
    const prompt = await inject({ session: { ...session, content: "昨天旅行" } });
    const automatic = prompt.match(/<recalled_sources>([\s\S]*)<\/recalled_sources>/)[1];
    assert.ok(automatic.length <= 4020, `automatic recall emitted ${automatic.length} characters`);
    assert.match(automatic, /内容已截断/);
    assert.ok(!automatic.includes("完整结尾"));
});

for (const kind of ["l2", "l3"])
    for (const operation of ["memory_recall", "history.recall", "l3_diary_generate"]) {
        test(`correction revalidates persisted ${kind} ${operation} in both L1 event lists without rewriting storage`, async (t) => {
            const { app } = await runtime(t);
            const store = new PersonStore(app.database, "review"),
                scope = mindScope(session);
            const { person: alice } = await store.recognize(scope, accountRef("onebot", "alice"), "Alice");
            await store.recognize(scope, accountRef("onebot", "bob"), "Bob");
            const row = (id, people) => ({
                id,
                platform: "onebot",
                channelId: "g",
                content: id + "完整原文",
                ...(kind === "l2"
                    ? { participantIds: people, startTimestamp: "2020-01-01T00:00:00Z", endTimestamp: "2020-01-02T00:00:00Z" }
                    : { mentionedUserIds: people, date: "2020-01-01" }),
            });
            const stale = row("stale", ["alice"]),
                unknown = row("unknown", []),
                safe = row("safe", ["bob"]);
            const page = {
                kind,
                records: [stale, unknown, safe],
                returned: 3,
                offset: 6,
                hasMore: true,
                nextOffset: 9,
                contentTruncated: false,
                target: { platform: "onebot", channelId: "g" },
            };
            const event = { type: "agent_observation", function: operation, status: "success", manualRecall: true, result: page };
            await app.database.create("saved_observations", { id: "recall", event });
            const before = { l1_working_memory: { new_events: [event], processed_events: [] } };
            await app.parallel("yesimbot/filter-recalled-memory", session, before);
            assert.deepEqual(before.l1_working_memory.new_events[0].result.records, page.records);
            await store.setProfile(scope, alice.id, "corrected profile", "admin");
            const stored = (await app.database.get("saved_observations", { id: "recall" }))[0].event;
            const wrapped = { ...stored, result: { status: "success", result: stored.result, metadata: { display: "silent" } } };
            const messageRecall = { ...stored, result: { ...page, kind: "messages" } };
            const unrelated = { ...stored, function: "unrelated_tool" };
            const rawMessage = { type: "message", content: "actual utterance", sender: { id: "alice" } };
            const state = {
                l1_working_memory: { new_events: [stored, messageRecall, unrelated, rawMessage], processed_events: [wrapped] },
                l2_retrieved_memories: [],
                l3_diary_entries: [],
            };
            await app.parallel("yesimbot/filter-recalled-memory", session, state);
            const result = state.l1_working_memory.new_events[0].result;
            assert.deepEqual(result.records, [safe]);
            assert.equal(result.returned, 1);
            assert.equal(state.l1_working_memory.new_events[0].manualRecall, true);
            assert.equal(result.nextOffset, 9, "cursor still advances past the original source page");
            assert.equal(result.hasMore, true);
            assert.equal(result.contentTruncated, false);
            assert.deepEqual(state.l1_working_memory.processed_events[0].result.result.records, [safe]);
            assert.deepEqual(state.l1_working_memory.processed_events[0].result.metadata, { display: "silent" });
            assert.strictEqual(state.l1_working_memory.new_events[1], messageRecall);
            assert.strictEqual(state.l1_working_memory.new_events[2], unrelated);
            assert.strictEqual(state.l1_working_memory.new_events[3], rawMessage);
            assert.deepEqual(stored.result.records, [stale, unknown, safe], "input snapshot event remains immutable");
            assert.deepEqual((await app.database.get("saved_observations", { id: "recall" }))[0].event, event);
        });
    }

test("person snapshots expire after source revocation and profile correction without mutating audit observations", async (t) => {
    let hiddenAllowed = true;
    const { app, tools } = await runtime(t, { recallScope: "mind", allow: (s) => s.channelId !== "hidden" || hiddenAllowed });
    const source = {
        ...session,
        userId: "alice",
        channelId: "hidden",
        messageId: "secret",
        content: "秘密旅行 PRIVATE-MEMORY",
        timestamp: Date.now(),
        author: { name: "Alice" },
    };
    await app.parallel("yesimbot/before-user-stimulus", source);
    const query = { session, query: "秘密旅行" };
    const recalled = await tools.get("person_recall").execute(query);
    assert.equal(recalled.result.sources.length, 1);
    const store = new PersonStore(app.database, "review"),
        scope = mindScope(session),
        ref = accountRef("onebot", "alice");
    await store.setProfile(scope, ref, "WRONG-PROFILE", "admin");
    const read = await tools.get("person_memory").execute({ session, action: "read", account_id: "alice" });
    const events = [
        { type: "agent_observation", function: "person_recall", result: recalled.result, metadata: recalled.metadata },
        { type: "agent_observation", function: "person_memory", result: read.result, metadata: read.metadata },
    ];
    const original = structuredClone(events);
    hiddenAllowed = false;
    await store.setProfile(scope, ref, "CORRECT-PROFILE", "admin");
    assert.equal((await tools.get("person_recall").execute(query)).result.sources.length, 0);
    const nested = { type: "agent_observation", function: "background_task_query", result: { task: { result: recalled } } };
    const wrapped = { type: "agent_observation", function: "person_memory", result: read };
    const state = { l1_working_memory: { new_events: [nested, wrapped], processed_events: events } };
    await app.parallel("yesimbot/filter-recalled-memory", session, state);
    assert.ok(!JSON.stringify(state).includes("PRIVATE-MEMORY"));
    assert.ok(!JSON.stringify(state).includes("WRONG-PROFILE"));
    const template = await readFile(new URL("../../core/resources/templates/l1_history_item.mustache", import.meta.url), "utf8");
    const prompt = new MustacheRenderer().render(
        "{{#events}}{{> observation}}{{/events}}",
        {
            events: state.l1_working_memory.processed_events.map((e) => ({ ...e, is_agent_observation: true })),
            _toString: function () {
                return JSON.stringify(this);
            },
        },
        { observation: template },
    );
    assert.ok(prompt.includes("人物记忆快照已过期"));
    assert.ok(!prompt.includes("PRIVATE-MEMORY"));
    assert.ok(!prompt.includes("WRONG-PROFILE"));
    assert.deepEqual(events, original);
    assert.equal(await tools.get("person_memory").isResultCurrent(read, session), false);
});

test("a source permission revoked during an awaited person read rejects the entire result", async (t) => {
    let hiddenAllowed = true;
    const { app, tools } = await runtime(t, { recallScope: "mind", allow: (s) => s.channelId !== "hidden" || hiddenAllowed });
    await app.parallel("yesimbot/before-user-stimulus", {
        ...session,
        channelId: "hidden",
        userId: "alice",
        messageId: "secret",
        content: "旅行 PRIVATE-CONCURRENT",
        timestamp: Date.now(),
        author: { name: "Alice" },
    });
    // Gate the actual source database read, after the tool has captured its initial
    // authorized snapshot. Revoking here exercises its post-await validation.
    const get = app.database.get.bind(app.database);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
            entered = r;
        }),
        gate = new Promise<void>((r) => {
            release = r;
        });
    app.database.get = async (table: any, ...args: any[]) => {
        const rows = await get(table, ...args);
        if (table === "person_memory.experiences") {
            entered();
            await gate;
        }
        return rows;
    };
    const pending = tools.get("person_recall").execute({ session, query: "旅行" });
    await reached;
    hiddenAllowed = false;
    release();
    const result = await pending;
    assert.equal(result.status, "error");
    assert.ok(!JSON.stringify(result).includes("PRIVATE-CONCURRENT"));
});
