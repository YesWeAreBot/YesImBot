import assert from "node:assert/strict";

import { test } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { SummaryWorker } from "../src/worker";
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
