import assert from "node:assert/strict";

import { test } from "vitest";

import { applySharedMemory } from "../src/shared-runtime";
import { PersonStore, accountRef, mindScope } from "../src/store";
import { fixture } from "./helpers";

const defaults = { mode: "review", modelGroup: "", summaryThreshold: 6, cooldownSeconds: 600, timeoutSeconds: 30, maxQueue: 32 };
const session = { platform: "onebot", selfId: "bot", channelId: "g", userId: "admin", isDirect: false };
async function runtime(t, config = {}) {
    let injection;
    const tools = new Map();
    const app = await fixture(t, (ctx) => {
        ctx.model.extend("saved_observations", { id: "string", event: "json" }, { primary: "id" });
        ctx.set("yesimbot", {
            world: { isChannelAllowed: () => true },
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
