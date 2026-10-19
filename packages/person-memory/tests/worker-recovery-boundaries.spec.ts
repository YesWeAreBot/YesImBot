import assert from "node:assert/strict";

import pluginMock from "@koishijs/plugin-mock";
import { test, vi } from "vitest";

import { summarySourceAllowed } from "../src/source-policy";
import { PersonStore, accountRef, mindScope, registerModels, sceneKey } from "../src/store";
import { SummaryQueue, registerSummaryQueueModels } from "../src/summary-queue";
import { SummaryWorker } from "../src/worker";
import { fixture } from "./helpers";

const mock = (pluginMock as any).default ?? pluginMock;
const config = { threshold: 1, cooldownMs: 1, timeoutMs: 1000, maxQueue: 2 };

async function legacyFixture(t, shared: boolean, imported = false) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    t.onTestFinished(() => vi.useRealTimers());
    const ctx = await fixture(t, (ctx) => {
        ctx.plugin(mock);
        registerModels(ctx);
        registerSummaryQueueModels(ctx);
    });
    const bot = ctx.bots[0];
    const scene = { platform: bot.platform, selfId: bot.selfId, channelId: "group", userId: "u" };
    const scopeOf = shared ? (session) => mindScope(session, "") : sceneKey;
    const scope = scopeOf(scene);
    const userId = shared ? accountRef(bot.platform, "u") : "u";
    const store = new PersonStore(ctx.database, "review");
    const secret = "旧正文没有来源，不应发送给摘要模型";
    if (imported) {
        await store.recognize("legacy", "u", "群友");
        await store.setProfile("legacy", "u", secret, "admin");
        await store.importScene(scope, bot.platform, await store.read("legacy"), "admin");
    } else {
        await store.recognize(scope, userId, "群友");
        await store.setProfile(scope, userId, secret, "admin");
    }
    vi.setSystemTime(Date.now() + 1);
    const found = await store.find(scope, userId);
    await store.capture(scope, {
        id: "new",
        userId,
        name: "群友",
        text: "我喜欢 Python",
        timestamp: Date.now(),
        provenance: { ...scene, scene: sceneKey(scene), messageId: "new", personId: found.person.id, accountRevision: found.accounts[0].bindingRevision ?? 0 },
    });
    const sourceAllowed = (scope, _userId, evidence) => summarySourceAllowed(ctx, evidence, scope, shared, () => true, scopeOf);
    return { ctx, store, scope, userId, secret, sourceAllowed };
}

for (const [shared, imported] of [
    [false, false],
    [true, false],
    [true, true],
]) {
    test(`summary omits unattributed prose and uses authorized new evidence (shared=${shared}, imported=${imported})`, async (t) => {
        const f = await legacyFixture(t, shared, imported);
        let input;
        const worker = new SummaryWorker(
            f.store,
            async (messages) => {
                assert.equal(JSON.stringify(messages).includes(f.secret), false);
                input = JSON.parse(messages[1].content);
                return JSON.stringify({ profile: "喜欢 Python", messageIds: ["new"] });
            },
            { ...config, sourceAllowed: f.sourceAllowed },
            () => {},
        );
        t.onTestFinished(() => worker.stop());
        const id = await worker.summarize(f.scope, f.userId);
        assert.equal(input.existingProfile, "");
        assert.equal(input.existingStructuredProfile, undefined);
        assert.deepEqual(
            input.evidence.map((source) => source.id),
            ["new"],
        );
        assert.ok((await f.store.read(f.scope)).proposals[id]);
        assert.equal((await f.store.find(f.scope, f.userId)).person.profile, f.secret);
    });
}

test("sanitized legacy input resumes after restart without restoring the omitted prose", async (t) => {
    const f = await legacyFixture(t, true);
    const queue = new SummaryQueue(f.ctx.database, "sanitized-recovery");
    const options = { ...config, durableQueue: queue, sourceAllowed: f.sourceAllowed, retryDelayMs: 10000 };
    const first = new SummaryWorker(
        f.store,
        async () => {
            throw new Error("provider unavailable");
        },
        options,
        () => {},
    );
    await assert.rejects(first.summarize(f.scope, f.userId), /provider unavailable/);
    await first.stop();
    const [saved] = await queue.pending();
    assert.equal(JSON.stringify(saved.input.messages).includes(f.secret), false);
    await queue.patch(saved, { nextAttempt: 0 });
    let calls = 0;
    const second = new SummaryWorker(
        f.store,
        async (messages) => {
            calls++;
            assert.equal(JSON.stringify(messages).includes(f.secret), false);
            return JSON.stringify({ profile: "喜欢 Python", messageIds: ["new"] });
        },
        options,
        () => {},
    );
    t.onTestFinished(() => second.stop());
    await second.init();
    await second.idle();
    assert.equal(calls, 1);
    assert.equal((await queue.list())[0].status, "accepted");
});

for (const shared of [false, true]) {
    test(`manual prose after retiring all claims is omitted from summary input (shared=${shared})`, async (t) => {
        const f = await legacyFixture(t, shared);
        const [source] = await f.store.profileSources(f.scope, f.userId, Date.now() - 86400000);
        await f.store.settings(f.scope, { mode: "auto" }, "admin");
        const before = await f.store.find(f.scope, f.userId);
        await f.store.proposeClaims(
            f.scope,
            f.userId,
            [{ action: "support", category: "preferences", statement: "喜欢 Python", messageIds: ["new"] }],
            "admin",
            {
                personId: before.person.id,
                personRevision: before.person.revision,
                accountRevision: before.accounts[0].revision,
            },
        );
        assert.equal((await f.store.find(f.scope, f.userId)).person.claims[0].status, "active");
        vi.setSystemTime(Date.now() + 1);
        await f.store.setProfile(f.scope, f.userId, f.secret, "admin");
        await f.store.settings(f.scope, { mode: "review" }, "admin");
        vi.setSystemTime(Date.now() + 1);
        await f.store.capture(f.scope, {
            ...source,
            id: "after-edit",
            timestamp: Date.now(),
            text: "我也喜欢 Rust",
            provenance: { ...source.provenance, messageId: "after-edit" },
        });
        let input;
        const worker = new SummaryWorker(
            f.store,
            async (messages) => {
                assert.equal(JSON.stringify(messages).includes(f.secret), false);
                input = JSON.parse(messages[1].content);
                return JSON.stringify({ changes: [{ action: "support", category: "preferences", statement: "喜欢 Rust", messageIds: ["after-edit"] }] });
            },
            { ...config, sourceAllowed: f.sourceAllowed },
            () => {},
        );
        t.onTestFinished(() => worker.stop());
        const id = await worker.summarize(f.scope, f.userId);
        assert.equal(input.existingProfile, "");
        assert.equal(input.existingStructuredProfile, undefined);
        assert.equal(input.claims[0].status, "retired");
        assert.ok((await f.store.read(f.scope)).proposals[id]);
        assert.equal((await f.store.find(f.scope, f.userId)).person.profile, f.secret);
    });
}

test("legacy saved output without an omission marker cannot bypass source authorization", async (t) => {
    const f = await legacyFixture(t, true);
    const queue = new SummaryQueue(f.ctx.database, "old-unsanitized-input");
    const job = await queue.enqueue(f.scope, f.userId);
    const found = await f.store.find(f.scope, f.userId);
    await queue.patch(job, {
        input: {
            messages: [{ role: "user", content: JSON.stringify({ existingProfile: f.secret }) }],
            permissionEvidence: await f.store.profileSources(f.scope, f.userId, Date.now() - 86400000),
            expected: { personId: found.person.id, personRevision: found.person.revision, accountRevision: found.accounts[0].revision },
            evidenceIds: ["new"],
            sourceCursor: ["new"],
        },
        output: { profile: "derived from unauthorized old prose", messageIds: ["new"] },
    });
    let calls = 0;
    const worker = new SummaryWorker(
        f.store,
        async () => {
            calls++;
            return "";
        },
        {
            ...config,
            durableQueue: queue,
            sourceAllowed: f.sourceAllowed,
        },
        () => {},
    );
    t.onTestFinished(() => worker.stop());
    await worker.init();
    await worker.idle();
    assert.equal(calls, 0);
    assert.equal((await queue.list())[0].status, "blocked");
    assert.equal(Object.keys((await f.store.read(f.scope)).proposals).length, 0);
    assert.equal((await f.store.find(f.scope, f.userId)).person.profile, f.secret);
});

test("an early retry wakeup reschedules the remaining delay without spending an attempt", async (t) => {
    const ctx = await fixture(t, (ctx) => {
        registerModels(ctx);
        registerSummaryQueueModels(ctx);
    });
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "u", "群友");
    await store.capture("s", { id: "m", userId: "u", name: "群友", text: "喜欢 Python", timestamp: Date.now() });
    let now = Date.now(),
        calls = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const queue = new SummaryQueue(ctx.database, "early-retry");
    const worker = new SummaryWorker(
        store,
        async () => {
            if (++calls === 1) throw new Error("provider unavailable");
            return JSON.stringify({ profile: "喜欢 Python", messageIds: ["m"] });
        },
        { ...config, durableQueue: queue, retryDelayMs: 1000 },
        () => {},
    );
    t.onTestFinished(async () => {
        await worker.stop();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    await assert.rejects(worker.summarize("s", "u"), /provider unavailable/);
    await worker.idle();
    const [saved] = await queue.pending();
    now = saved.nextAttempt - 1;
    await vi.advanceTimersByTimeAsync(1000);
    await worker.idle();
    assert.equal(calls, 1);
    assert.equal((await queue.pending())[0].attempts, 1);
    now = saved.nextAttempt;
    await vi.advanceTimersByTimeAsync(1);
    await worker.idle();
    assert.equal(calls, 2);
    assert.equal((await queue.list())[0].status, "accepted");
    assert.equal(Object.keys((await store.read("s")).proposals).length, 1);
});
