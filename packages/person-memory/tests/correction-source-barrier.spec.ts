import assert from "node:assert/strict";

import { test } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { SummaryWorker } from "../src/worker";
import { fixture } from "./helpers";

const source = (id: string, timestamp: number) => ({ id, userId: "u", name: "User", text: `evidence ${id}`, timestamp });
async function setup(t) {
    const app = await fixture(t, registerModels);
    const store = new PersonStore(app.database, "auto");
    await store.recognize("s", "u", "User");
    await store.capture("s", source("old", Date.now() - 1000));
    return store;
}

test("manual clear rejects legacy old evidence even with current versions and allows only post-clear sources", async (t) => {
    const store = await setup(t);
    const cleared = await store.setProfile("s", "u", "", "admin");
    const current = await store.find("s", "u");
    const expected = { personId: current.person.id, personRevision: current.person.revision, accountRevision: current.accounts[0].revision };
    await assert.rejects(store.propose("s", "u", "revived", ["old"], "model", expected), /来源.*过期/);
    await store.capture("s", source("boundary", cleared.memoryChangedAt));
    await assert.rejects(store.propose("s", "u", "revived", ["boundary"], "model", expected), /来源.*过期/);
    await store.capture("s", source("new", cleared.memoryChangedAt + 1));
    await store.propose("s", "u", "new facts", ["new"], "model", expected);
    assert.equal((await store.find("s", "u")).person.profile, "new facts");
    assert.deepEqual(
        (await store.sources("s", "u")).map((item) => item.id),
        ["old", "boundary", "new"],
        "original sources remain immutable",
    );
});

test("clear also prevents legacy old evidence from creating identity link proposals", async (t) => {
    const store = await setup(t);
    const target = await store.recognize("s", "v", "Target");
    const cleared = await store.setProfile("s", "u", "", "admin");
    const current = await store.find("s", "u");
    const expected = {
        personId: current.person.id,
        personRevision: current.person.revision,
        accountRevision: current.accounts[0].revision,
        targetRevision: target.person.revision,
    };
    await assert.rejects(store.proposeLink("s", "u", target.person.id, 0.8, "same person", ["old"], "model", expected), /来源.*过期/);
    await store.capture("s", source("new", cleared.memoryChangedAt + 1));
    const proposal = await store.proposeLink("s", "u", target.person.id, 0.8, "same person", ["new"], "model", expected);
    assert.equal(proposal.state, "pending");
});

test("pending legacy summarize cannot undo a clear and a later job only sees fresh evidence", async (t) => {
    const store = await setup(t);
    let started!: () => void, finish!: (text: string) => void;
    const entered = new Promise<void>((resolve) => (started = resolve));
    const calls: any[] = [];
    const worker = new SummaryWorker(
        store,
        async (messages) => {
            const data = JSON.parse(messages[1].content);
            calls.push(data);
            if (calls.length === 1) {
                started();
                return new Promise<string>((resolve) => (finish = resolve));
            }
            return JSON.stringify({ profile: "new facts", messageIds: data.evidence.map((item) => item.id) });
        },
        { threshold: 2, cooldownMs: 0, timeoutMs: 1000, maxQueue: 2 },
        () => {},
    );
    t.onTestFinished(() => worker.stop());
    const pending = worker.summarize("s", "u");
    await entered;
    const cleared = await store.setProfile("s", "u", "", "admin");
    finish(JSON.stringify({ profile: "revived", messageIds: ["old"] }));
    await assert.rejects(pending, /过期/);
    await assert.rejects(worker.summarize("s", "u"), /没有可用.*来源/);
    assert.equal(calls.length, 1, "old sources never reach another model call after clear");
    await store.capture("s", source("new", cleared.memoryChangedAt + 1));
    await worker.summarize("s", "u");
    assert.deepEqual(
        calls[1].evidence.map((item) => item.id),
        ["new"],
    );
    assert.equal((await store.find("s", "u")).person.profile, "new facts");
});
