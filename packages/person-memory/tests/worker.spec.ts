import assert from "node:assert/strict";

import { test } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { SummaryWorker, summaryResponseText } from "../src/worker";
import { fixture } from "./helpers";
async function setup(t, model, options = {}) {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const errors = [];
    const worker = new SummaryWorker(store, model, { threshold: 2, cooldownMs: 60000, timeoutMs: 1000, maxQueue: 2, ...options }, (error) =>
        errors.push(error),
    );
    t.onTestFinished(() => worker.stop());
    return { store, worker, errors };
}
async function capture(store, scope = "s", uid = "u", id = "m") {
    await store.recognize(scope, uid, "群友");
    await store.capture(scope, { id, userId: uid, name: "群友", text: "我喜欢 Python", timestamp: Date.now() });
}
test("automatic batch produces grounded candidate, cooldown coalesces calls, inputs stay scoped", async (t) => {
    const calls = [];
    const { store, worker } = await setup(t, async (messages) => {
        calls.push(messages);
        return JSON.stringify({ profile: "喜欢 Python", messageIds: ["m"] });
    });
    await capture(store);
    await capture(store, "other", "u", "SECRET");
    await worker.observe("s", "u");
    await worker.idle();
    assert.equal(calls.length, 0);
    await worker.observe("s", "u");
    await worker.idle();
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls[0]).includes("SECRET"), false);
    assert.equal(Object.keys((await store.read("s")).proposals).length, 1);
    await worker.observe("s", "u");
    await worker.observe("s", "u");
    await worker.idle();
    assert.equal(calls.length, 1);
});
test("late model result after admin edit cannot overwrite profile", async (t) => {
    let resolve, started;
    const start = new Promise((r) => (started = r));
    const { store, worker } = await setup(t, () => {
        started();
        return new Promise((r) => (resolve = r));
    });
    await capture(store);
    const job = worker.summarize("s", "u");
    await start;
    await store.setProfile("s", "u", "人工结果", "admin");
    resolve(JSON.stringify({ profile: "旧结果", messageIds: ["m"] }));
    await assert.rejects(job, /过期/);
    assert.equal((await store.find("s", "u")).person.profile, "人工结果");
});
test("unload aborts work and ignores a model that returns late", async (t) => {
    let resolve, started, signal;
    const start = new Promise((r) => (started = r));
    const { store, worker } = await setup(t, (_messages, s) => {
        signal = s;
        started();
        return new Promise((r) => (resolve = r));
    });
    await capture(store);
    const job = worker.summarize("s", "u");
    await start;
    worker.stop();
    await assert.rejects(job, /取消/);
    resolve(JSON.stringify({ profile: "迟到结果", messageIds: ["m"] }));
    await worker.idle();
    assert.equal(signal.aborted, true);
    assert.equal(Object.keys((await store.read("s")).proposals).length, 0);
});
test("bad output, missing evidence, pause and timeout fail without profile writes", async (t) => {
    const { store, worker } = await setup(t, async () => "{broken");
    await capture(store);
    await assert.rejects(worker.summarize("s", "u"));
    await store.settings("s", { paused: true }, "admin");
    await assert.rejects(worker.summarize("s", "u"), /暂停/);
    assert.equal((await store.find("s", "u")).person.profile, "");
    const timed = await setup(t, () => new Promise(() => {}), { timeoutMs: 10 });
    await capture(timed.store);
    await assert.rejects(timed.worker.summarize("s", "u"), /超时/);
});
test("queue rejects overflow, serializes scopes and aborts queued scene on pause", async (t) => {
    let resolve, started;
    const start = new Promise((r) => (started = r));
    const { store, worker } = await setup(
        t,
        () => {
            started();
            return new Promise((r) => (resolve = r));
        },
        { maxQueue: 1 },
    );
    await capture(store, "s", "u");
    await capture(store, "other", "u");
    await capture(store, "third", "u");
    const a = worker.summarize("s", "u");
    await start;
    const b = worker.summarize("other", "u");
    await assert.rejects(worker.summarize("third", "u"), /队列/);
    worker.cancel("other");
    await assert.rejects(b, /取消/);
    resolve(JSON.stringify({ profile: "喜欢 Python", messageIds: ["m"] }));
    await a;
});
test("a manual job queued immediately after completion is never stranded", async (t) => {
    const { store, worker } = await setup(t, async () => JSON.stringify({ profile: "喜欢 Python", messageIds: ["m"] }), { timeoutMs: 30 });
    await capture(store);
    await worker.summarize("s", "u");
    const second = worker.summarize("s", "u");
    const timeout = new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("stranded queue")), 100);
        second.finally(() => clearTimeout(timer)).catch(() => {});
    });
    await Promise.race([second, timeout]);
});
test("blank summary reports an actionable error and does not create a proposal", async (t) => {
    const { store, worker } = await setup(t, async () => "   ");
    await capture(store);
    await assert.rejects(worker.summarize("s", "u"), /人物总结.*空白/);
});
test("invalid summary JSON reports the stage without exposing the raw response", async (t) => {
    const { store, worker } = await setup(t, async () => "private-secret");
    await capture(store);
    await assert.rejects(worker.summarize("s", "u"), (error) => /人物总结.*JSON/.test(error.message) && !error.message.includes("private-secret"));
});
test("truncated summary is rejected before JSON parsing with the output limit identified", () => {
    assert.throws(() => summaryResponseText({ text: "", finishReason: "length" }, 4096), /4096.*截断/);
    assert.equal(summaryResponseText({ text: '{"profile":""}', finishReason: "stop" }, 4096), '{"profile":""}');
});

test("summary uses a bounded latest sample with complete recorded seven-day scene counts", async (t) => {
    let input;
    const { store, worker } = await setup(
        t,
        async (messages) => {
            input = { messages, data: JSON.parse(messages[1].content) };
            return JSON.stringify({ profile: "最近学习 Python", messageIds: ["recent-44"] });
        },
        { systemPrompt: "自定义写作策略" },
    );
    await store.recognize("s", "u", "群友");
    const now = Date.now();
    await store.capture("s", { id: "old", userId: "u", name: "旧昵称", text: "过期消息", timestamp: now - 8 * 86400000 });
    for (let i = 0; i < 45; i++) {
        await store.capture("s", { id: `recent-${i}`, userId: "u", name: "群友", text: `Python ${i}`, timestamp: now - 86400000 + i });
    }
    await worker.summarize("s", "u");
    assert.equal(input.data.evidence.length, 40);
    assert.equal(input.data.evidence[0].id, "recent-5");
    assert.equal(input.data.evidence.at(-1).id, "recent-44");
    assert.equal(input.data.window.to - input.data.window.from, 7 * 86400000);
    assert.equal(input.data.window.coverage, "recorded_only");
    assert.equal(input.data.window.dayBoundary, "UTC");
    assert.equal(input.data.scenes[0].key, JSON.stringify(["", "", ""]));
    assert.equal(input.data.scenes[0].recent.messageCount, 45);
    assert.equal(input.data.scenes[0].sampleCount, 40);
    assert.equal(input.data.scenes[0].recent.activeDays, 1);
    assert.equal(input.data.scenes[0].nickname, "群友");
    assert.equal(JSON.stringify(input).includes("过期消息"), false);
    assert.ok(input.messages[0].content.includes("自定义写作策略"));
});

test("summary cannot cite captured evidence excluded from its bounded input", async (t) => {
    const { store, worker } = await setup(t, async () => JSON.stringify({ profile: "喜欢 Python", messageIds: ["old"] }));
    await capture(store, "s", "u", "old");
    for (let i = 0; i < 41; i++) await capture(store, "s", "u", `new-${i}`);
    await assert.rejects(worker.summarize("s", "u"), /证据/);
    assert.equal(Object.keys((await store.read("s")).proposals).length, 0);
});

test("full structured candidate is preserved and injected into the next maintenance call as data", async (t) => {
    const document = {
        version: 1,
        background: ["软件工程学生"],
        goals: ["学习 Python"],
        contexts: [],
        needs: [],
        preferences: [],
        values: [],
        scenes: [],
        overview: "学习 Python",
    };
    const inputs = [];
    const { store, worker } = await setup(t, async (messages) => {
        inputs.push(JSON.parse(messages[1].content));
        return JSON.stringify({ profile: document, messageIds: [inputs.at(-1).evidence.at(-1).id] });
    });
    await capture(store);
    const id = await worker.summarize("s", "u");
    const proposal = (await store.read("s")).proposals[id];
    assert.deepEqual(proposal.structuredProfile.background, ["软件工程学生"]);
    await store.setProfile("s", "u", proposal.structuredProfile, "admin");
    await capture(store, "s", "u", "new");
    await worker.summarize("s", "u");
    assert.deepEqual(inputs[1].existingStructuredProfile, proposal.structuredProfile);
    assert.ok(inputs[1].existingProfile.includes("学习 Python"));
});

test("malformed structured candidate is rejected before any proposal is written", async (t) => {
    const { store, worker } = await setup(t, async () => JSON.stringify({ profile: { version: 1, overview: "幻觉" }, messageIds: ["m"] }));
    await capture(store);
    await assert.rejects(worker.summarize("s", "u"), /画像/);
    assert.equal(Object.keys((await store.read("s")).proposals).length, 0);
});

test("stale plain and structured profiles are excluded after account identity changes", async (t) => {
    let input;
    const { store, worker } = await setup(t, async (messages) => {
        input = JSON.parse(messages[1].content);
        return JSON.stringify({ profile: "", messageIds: [] });
    });
    await capture(store);
    await store.setProfile(
        "s",
        "u",
        { version: 1, background: ["过时背景"], goals: [], contexts: [], needs: [], preferences: [], values: [], scenes: [], overview: "过时画像" },
        "admin",
    );
    await store.recognize("s", "linked", "另一个账号");
    await store.bind("s", "linked", "u", 1, "admin");
    await capture(store, "s", "u", "new");
    await worker.summarize("s", "u");
    assert.equal(input.existingProfile, "");
    assert.equal(input.existingStructuredProfile, undefined);
    assert.equal(JSON.stringify(input).includes("过时背景"), false);
});

test("worker retains identity-valid linked-account evidence returned by the store", async (t) => {
    let input;
    const { store, worker } = await setup(t, async (messages) => {
        input = JSON.parse(messages[1].content);
        return JSON.stringify({ profile: "", messageIds: [] });
    });
    await capture(store);
    const found = await store.find("s", "u");
    // The store resolves each originating account's revision; it need not match
    // the requesting account's revision. Isolate that dependency contract here.
    store.profileSources = async () => [
        {
            id: "linked-message",
            userId: "linked",
            name: "群友",
            text: "正在学习 Python",
            timestamp: Date.now(),
            provenance: { platform: "test", selfId: "bot", channelId: "group", messageId: "linked-message", personId: found.person.id, accountRevision: 7 },
        },
    ];
    await worker.summarize("s", "u");
    assert.equal(input.evidence[0].id, "linked-message");
});
