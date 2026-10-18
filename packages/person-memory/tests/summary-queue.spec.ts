import assert from "node:assert/strict";

import { test } from "vitest";

import { registerSummaryQueueModels, SummaryQueue } from "../src/summary-queue";
import { fixture } from "./helpers";

test("pending input, output, attempt reasons and receipts survive adapter replacement", async (t) => {
    const ctx = await fixture(t, registerSummaryQueueModels);
    const first = new SummaryQueue(ctx.database, "plugin");
    const job = await first.enqueue("s", "u");
    await first.patch(job, {
        attempts: 1,
        reason: "timeout",
        nextAttempt: 123,
        input: { messages: [], expected: { personId: "p", personRevision: 0, accountRevision: 0 }, evidenceIds: ["m"], sourceCursor: ["m"] },
        output: { profile: "likes tea", messageIds: ["m"] },
    });
    const second = new SummaryQueue(ctx.database, "plugin");
    const [restored] = await second.pending();
    assert.equal(restored.id, job.id);
    assert.equal(restored.reason, "timeout");
    assert.equal(restored.attempts, 1);
    assert.deepEqual(restored.input.sourceCursor, ["m"]);
    await second.accept(restored, "proposal");
    assert.equal((await new SummaryQueue(ctx.database, "plugin").pending()).length, 0);
    assert.deepEqual(await first.checkpoint("s", "u"), ["m"]);
    assert.equal((await second.list())[0].receipt, "proposal");
    assert.equal((await second.list())[0].input, undefined);
    assert.equal((await second.list())[0].output, undefined);
});

test("cancel invalidates old generations and duplicate local owners cannot claim", async (t) => {
    const ctx = await fixture(t, registerSummaryQueueModels);
    const first = new SummaryQueue(ctx.database, "plugin"),
        second = new SummaryQueue(ctx.database, "plugin");
    const job = await first.enqueue("s", "u");
    assert.equal(first.claim(job), true);
    assert.equal(second.claim(job), false);
    await second.cancel("s");
    assert.equal(await first.valid(job), false);
    await assert.rejects(first.accept(job, "late"), /取消/);
    first.release(job);
    const fresh = await second.enqueue("s", "u");
    assert.notEqual(fresh.id, job.id);
    assert.ok(fresh.generation > job.generation);
});

test("explicit retry preserves an unacknowledged output request ID", async (t) => {
    const ctx = await fixture(t, registerSummaryQueueModels);
    const queue = new SummaryQueue(ctx.database, "plugin");
    const job = await queue.enqueue("s", "u");
    await queue.patch(job, { output: { profile: "喜欢茶", messageIds: ["m"] }, status: "failed", attempts: 3, reason: "ack failed" });
    const retry = await new SummaryQueue(ctx.database, "plugin").enqueue("s", "u");
    assert.equal(retry.id, job.id);
    assert.equal(retry.status, "pending");
    assert.deepEqual(retry.output, job.output);
});
