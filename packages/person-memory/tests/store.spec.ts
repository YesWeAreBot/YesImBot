import assert from "node:assert/strict";

import { test } from "vitest";

import { PersonStore, registerModels, sceneKey } from "../src/store";
import { fixture, reopen } from "./helpers";

const scene = sceneKey({ platform: "onebot", selfId: "bot", channelId: "group", userId: "u", isDirect: false });
const actor = "admin:42";
async function setup(t) {
    const ctx = await fixture(t, registerModels);
    return { ctx, store: new PersonStore(ctx.database, "review") };
}
const source = (id, userId = "u1") => ({ id, userId, name: "小明", text: "我喜欢写 Python", timestamp: 123456 });

test("stable UUID survives rename/restart; same nickname and other scenes stay separate", async (t) => {
    const { ctx, store } = await setup(t);
    const a = await store.recognize(scene, "u1", "小明");
    const b = await store.recognize(scene, "u2", "小明");
    assert.notEqual(a.person.id, b.person.id);
    assert.equal((await store.recognize(scene, "u1", "改名")).person.id, a.person.id);
    const other = sceneKey({ platform: "onebot", selfId: "bot", channelId: "other", userId: "u", isDirect: false });
    assert.equal(await store.find(other, a.person.id), undefined);
    assert.equal((await new PersonStore(ctx.database, "review").find(scene, "u1")).person.id, a.person.id);
});
test("scene keys isolate private peers, groups, platforms and bots", () => {
    const base = { platform: "onebot", selfId: "b", channelId: "same", userId: "u1", isDirect: false };
    const keys = [base, { ...base, isDirect: true }, { ...base, isDirect: true, userId: "u2" }, { ...base, selfId: "b2" }, { ...base, platform: "other" }].map(
        sceneKey,
    );
    assert.equal(new Set(keys).size, keys.length);
    assert.throws(() => sceneKey({ ...base, selfId: "" }));
});
test("evidence is validated; review, locks and concurrent manual edits invalidate stale proposals", async (t) => {
    const { store } = await setup(t);
    await store.recognize(scene, "u1", "小明");
    await store.capture(scene, source("m1"));
    await store.capture(scene, source("m2", "u2"));
    await assert.rejects(store.propose(scene, "u1", "爱写代码", ["m2"], "model"), /来源/);
    const p = await store.propose(scene, "u1", "喜欢 Python", ["m1"], "model");
    assert.equal((await store.find(scene, "u1")).person.profile, "");
    await store.setProfile(scene, "u1", "管理员补充", actor);
    await assert.rejects(store.review(scene, p.id, true, actor), /过期/);
    await store.lock(scene, "u1", true, actor);
    await assert.rejects(store.propose(scene, "u1", "模型改写", ["m1"], "model"), /锁定/);
    await store.lock(scene, "u1", false, actor);
    const p2 = await store.propose(scene, "u1", "喜欢 Python", ["m1"], "model");
    await store.review(scene, p2.id, true, actor);
    const person = (await store.find(scene, "u1")).person;
    assert.equal(person.profile, "喜欢 Python");
    assert.equal(person.evidence[0].userId, "u1");
});
test("merge and split preserve evidence, mark contamination and reject stale bindings", async (t) => {
    const { store } = await setup(t);
    const a = await store.recognize(scene, "u1", "甲");
    const b = await store.recognize(scene, "u2", "乙");
    await store.capture(scene, source("m1"));
    const p = await store.propose(scene, "u1", "喜欢 Python", ["m1"], "model");
    await store.review(scene, p.id, true, actor);
    await store.merge(scene, a.person.id, b.person.id, actor);
    assert.equal((await store.find(scene, "u1")).person.id, b.person.id);
    assert.equal((await store.find(scene, "u2")).person.stale, true);
    assert.equal((await store.find(scene, "u2")).person.evidence[0].userId, "u1");
    await store.split(scene, "u1", "新甲", actor);
    assert.notEqual((await store.find(scene, "u1")).person.id, b.person.id);
    assert.equal((await store.find(scene, "u2")).person.stale, true);
    assert.equal((await store.sources(scene, "u1"))[0].userId, "u1");
});
test("parallel stores do not lose updates; history reverts without overriding later changes", async (t) => {
    const { ctx, store } = await setup(t);
    const store2 = new PersonStore(ctx.database, "review");
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? store : store2).recognize(scene, `u${i}`, "小明")));
    assert.equal(Object.keys((await store.read(scene)).accounts).length, 12);
    await store.setProfile(scene, "u1", "first", actor);
    const first = (await store.history(scene))[0];
    await store.setProfile(scene, "u1", "second", actor);
    await assert.rejects(store.revert(scene, first.id, actor), /后续修改/);
    const last = (await store.history(scene))[0];
    await store.revert(scene, last.id, actor);
    assert.equal((await store.find(scene, "u1")).person.profile, "first");
});
test("pause blocks model mutations and auto mode accepts only fresh grounded proposals", async (t) => {
    const { store } = await setup(t);
    await store.recognize(scene, "u1", "甲");
    await store.capture(scene, source("m1"));
    await store.settings(scene, { mode: "auto" }, actor);
    await store.propose(scene, "u1", "喜欢 Python", ["m1"], "model");
    assert.equal((await store.find(scene, "u1")).person.profile, "喜欢 Python");
    await store.settings(scene, { paused: true }, actor);
    await assert.rejects(store.propose(scene, "u1", "后来的", ["m1"], "model"), /暂停/);
    assert.equal((await store.find(scene, "u1")).person.profile, "喜欢 Python");
});
test("SQLite file reopening preserves UUID, reviewed profile, source and audit", async (t) => {
    const { ctx, store } = await setup(t);
    const initial = await store.recognize(scene, "u1", "卅");
    await store.capture(scene, source("m1"));
    const proposal = await store.propose(scene, "u1", "喜欢 Python", ["m1"], "model");
    await store.review(scene, proposal.id, true, actor);
    const next = await reopen(ctx, registerModels),
        restored = new PersonStore(next.database, "off");
    const found = await restored.find(scene, "u1");
    assert.equal(found.person.id, initial.person.id);
    assert.equal(found.person.profile, "喜欢 Python");
    assert.equal((await restored.read(scene)).settings.mode, "review");
    assert.equal((await restored.sources(scene, "u1"))[0].id, "m1");
    assert.equal((await restored.history(scene))[0].action, "approve");
});
test("audit failure leaves state unchanged; evidence cannot be rewritten by duplicate message id", async (t) => {
    const { ctx, store } = await setup(t);
    await store.recognize(scene, "u1", "甲");
    await store.capture(scene, source("m1"));
    await store.capture(scene, { ...source("m1", "u2"), text: "伪造" });
    assert.equal((await store.sources(scene, "u1"))[0].text, "我喜欢写 Python");
    const db = new Proxy(ctx.database, {
        get(target, key) {
            if (key === "create")
                return async (table, data) => {
                    if (table === "person_memory.audit") throw new Error("audit unavailable");
                    return target.create(table, data);
                };
            const v = target[key];
            return typeof v === "function" ? v.bind(target) : v;
        },
    });
    await assert.rejects(new PersonStore(db, "review").setProfile(scene, "u1", "失败写入", actor), /audit unavailable/);
    assert.equal((await store.find(scene, "u1")).person.profile, "");
    assert.equal((await store.history(scene)).length, 1);
});
test("recent source retention is bounded while pending evidence stays available", async (t) => {
    const { store } = await setup(t);
    await store.recognize(scene, "u1", "甲");
    await store.capture(scene, source("first"));
    const p = await store.propose(scene, "u1", "喜欢 Python", ["first"], "model");
    for (let i = 0; i < 201; i++) await store.capture(scene, { ...source(`new${i}`), timestamp: 200000 + i });
    const candidate = (await store.read(scene)).proposals[p.id];
    assert.equal(candidate.evidence[0].id, "first");
    await assert.rejects(store.propose(scene, "u1", "旧来源", ["first"], "model"), /来源/);
    await store.review(scene, p.id, true, actor);
    assert.equal((await store.find(scene, "u1")).person.evidence[0].id, "first");
});
test("revert then rebind never recycles an association version or revives old proposal", async (t) => {
    const { store } = await setup(t);
    const p = await store.create(scene, "甲", actor);
    await store.bind(scene, "u1", p.id, 1, actor);
    const bind = (await store.history(scene))[0];
    const original = (await store.find(scene, "u1")).accounts[0].revision;
    await store.capture(scene, source("m1"));
    const proposal = await store.propose(scene, "u1", "旧候选", ["m1"], "model");
    await store.revert(scene, bind.id, actor);
    await store.bind(scene, "u1", p.id, 1, actor);
    const current = (await store.find(scene, "u1")).accounts[0].revision;
    assert.ok(current > original);
    await assert.rejects(store.review(scene, proposal.id, true, actor));
    assert.equal((await store.find(scene, "u1")).person.profile, "");
});
test("new account binding invalidates existing profile and pre-binding proposals", async (t) => {
    const { store } = await setup(t);
    await store.recognize(scene, "u1", "甲");
    await store.capture(scene, source("m1"));
    await store.setProfile(scene, "u1", "旧画像", actor);
    const proposal = await store.propose(scene, "u1", "旧候选", ["m1"], "model");
    await store.bind(scene, "u2", "u1", 0.9, actor);
    assert.equal((await store.find(scene, "u1")).person.stale, true);
    await assert.rejects(store.review(scene, proposal.id, true, actor));
});
test("cancellation before commit rejects model proposal and auto profile", async (t) => {
    const { ctx, store } = await setup(t);
    await store.recognize(scene, "u1", "甲");
    await store.capture(scene, source("m1"));
    await store.settings(scene, { mode: "auto" }, actor);
    let active = true;
    const db = new Proxy(ctx.database, {
        get(target, key) {
            if (key === "get")
                return async (table, ...args) => {
                    const result = await target.get(table, ...args);
                    if (table === "person_memory.sources") active = false;
                    return result;
                };
            const v = target[key];
            return typeof v === "function" ? v.bind(target) : v;
        },
    });
    await assert.rejects(
        new PersonStore(db, "auto").propose(scene, "u1", "迟到结果", ["m1"], "model", undefined, () => active),
        /取消/,
    );
    assert.equal((await store.find(scene, "u1")).person.profile, "");
    assert.equal((await store.history(scene))[0].action, "settings");
});
test("late cancellation during successful audit INSERT keeps accepted auto profile and evidence", async (t) => {
    const { ctx, store } = await setup(t);
    await store.recognize(scene, "u1", "甲");
    await store.capture(scene, source("m1"));
    await store.settings(scene, { mode: "auto" }, actor);
    let active = true;
    const db = new Proxy(ctx.database, {
        get(target, key) {
            if (key === "create")
                return async (table, data) => {
                    const result = await target.create(table, data);
                    if (table === "person_memory.audit") active = false;
                    return result;
                };
            const v = target[key];
            return typeof v === "function" ? v.bind(target) : v;
        },
    });
    const result = await new PersonStore(db, "auto").propose(scene, "u1", "已接受画像", ["m1"], "model", undefined, () => active);
    assert.equal(result.state, "accepted");
    assert.equal((await store.find(scene, "u1")).person.profile, "已接受画像");
    assert.equal((await store.find(scene, "u1")).person.evidence[0].id, "m1");
    assert.equal((await store.history(scene))[0].action, "proposal");
});
