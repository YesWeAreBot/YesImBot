import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { validateProfileDocument, renderProfileDocument, type ProfileDocument } from "../src/profile";
import { PersonStore, registerModels } from "../src/store";
import { fixture } from "./helpers";

function document(): ProfileDocument {
    return {
        version: 1,
        background: ["学生"],
        goals: [],
        contexts: [],
        needs: [],
        preferences: ["喜欢 Python"],
        values: [],
        scenes: [],
        overview: "模型增加的无依据结论",
    };
}
test("profile validation bounds exact schema and derives overview only from current fields", () => {
    const doc = validateProfileDocument(document());
    assert.ok(doc.overview.includes("学生"));
    assert.ok(!doc.overview.includes("无依据"));
    const rendered = renderProfileDocument(doc);
    assert.ok(rendered.includes("背景"));
    assert.ok(rendered.endsWith(doc.overview));
    for (const bad of [
        { ...document(), extra: true },
        { ...document(), version: 2 },
        { ...document(), needs: [42] },
        { ...document(), preferences: ["x".repeat(13000)] },
        Object.assign(Object.create({}), document()),
    ])
        assert.throws(() => validateProfileDocument(bad));
});
test("structured proposal, approval, string correction and undo keep rendered and structured state atomic", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "u", "甲");
    await store.capture("s", { id: "m", userId: "u", name: "甲", text: "喜欢 Python", timestamp: Date.now() });
    const proposal = await store.propose("s", "u", document(), ["m"], "model");
    assert.deepEqual(proposal.structuredProfile, validateProfileDocument(document()));
    assert.equal((await store.find("s", "u")).person.profile, "");
    await store.review("s", proposal.id, true, "admin");
    const approved = (await store.find("s", "u")).person;
    assert.equal(approved.profile, renderProfileDocument(approved.structuredProfile));
    await store.setProfile("s", "u", "人工原文", "admin");
    assert.equal((await store.find("s", "u")).person.structuredProfile, undefined);
    await store.revert("s", (await store.history("s"))[0].id, "admin");
    assert.deepEqual((await store.find("s", "u")).person.structuredProfile, approved.structuredProfile);
    await store.setProfile("s", "u", { ...document(), background: Array.from({ length: 8 }).fill("背景".repeat(100)) }, "admin");
    assert.ok((await store.find("s", "u")).person.profile.length > 2000);
    await assert.rejects(store.setProfile("s", "u", "x".repeat(2001), "admin"));
});
test("all recorded seven-day sources determine scene metadata and counts rather than model claims", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const { person, account } = await store.recognize("s", "u", "甲");
    const now = Date.now();
    for (let i = 0; i < 205; i++)
        await store.capture("s", {
            id: `m${i}`,
            userId: "u",
            name: "甲",
            text: "讨论代码",
            timestamp: now - i,
            provenance: {
                platform: "qq",
                selfId: "bot",
                channelId: "group",
                messageId: `m${i}`,
                scene: "scene",
                personId: person.id,
                accountRevision: account.bindingRevision ?? 0,
            },
        });
    const doc = document();
    doc.scenes = [
        {
            key: "scene",
            platform: "fake",
            selfId: "fake",
            channelId: "fake",
            nickname: "fake",
            recent: {
                from: 0,
                to: 1,
                coverage: "recorded_only",
                messageCount: 9999,
                activeDays: 7,
                topics: ["代码"],
                emotions: [],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: [],
            openers: [],
        },
    ];
    assert.equal((await store.profileSources("s", "u", now - 7 * 86400000)).length, 205);
    const p = await store.propose("s", "u", doc, ["m204"], "model");
    const scene = p.structuredProfile.scenes[0];
    assert.equal(scene.platform, "qq");
    assert.equal(scene.nickname, "甲");
    assert.equal(scene.recent.messageCount, 205);
    assert.equal(scene.recent.activeDays, 1);
    assert.ok(scene.recent.from > 0);
    assert.ok(scene.recent.to >= now);
    await store.setProfile("s", "u", "纠正", "admin");
    assert.equal((await store.profileSources("s", "u", now - 7 * 86400000)).length, 0);
});
test("merge preserves complete source text while discarding stale structure", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "a", "甲");
    await store.recognize("s", "b", "乙");
    await store.setProfile("s", "a", document(), "admin");
    const original = (await store.find("s", "a")).person.profile;
    await store.setProfile("s", "b", "b".repeat(1900), "admin");
    await store.merge("s", "a", "b", "admin");
    const merged = (await store.find("s", "b")).person;
    assert.ok(merged.profile.includes(original));
    assert.equal(merged.structuredProfile, undefined);
});
test("profile source statistics exclude invalid identity, other scope, future and pre-window captures", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const { person, account } = await store.recognize("s", "u", "甲");
    const timestamp = Date.now();
    const source = {
        id: "valid",
        userId: "u",
        name: "甲",
        text: "内容",
        timestamp,
        provenance: {
            platform: "qq",
            selfId: "bot",
            channelId: "group",
            messageId: "valid",
            scene: "scene",
            personId: person.id,
            accountRevision: account.bindingRevision ?? 0,
        },
    };
    await store.capture("s", source);
    await store.capture("other", { ...source, id: "other-scope" });
    await store.capture("s", { ...source, id: "wrong-person", provenance: { ...source.provenance, personId: "other" } });
    await store.capture("s", { ...source, id: "wrong-binding", provenance: { ...source.provenance, accountRevision: 999 } });
    await store.capture("s", { ...source, id: "future", timestamp: timestamp + 86400000 });
    await store.capture("s", { ...source, id: "old", timestamp: timestamp - 8 * 86400000 });
    assert.deepEqual(
        (await store.profileSources("s", "u", timestamp - 7 * 86400000)).map((e) => e.id),
        ["valid"],
    );
});
test("unknown scene cannot manufacture activity and import retains the entire original string", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "u", "甲");
    await store.capture("s", { id: "m", userId: "u", name: "甲", text: "内容", timestamp: Date.now() });
    const doc = document();
    doc.scenes = [
        {
            key: "unknown",
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            nickname: "甲",
            recent: {
                from: 0,
                to: 1,
                coverage: "recorded_only",
                messageCount: 5,
                activeDays: 2,
                topics: [],
                emotions: [],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: [],
            openers: [],
        },
    ];
    await assert.rejects(store.propose("s", "u", doc, ["m"], "model"), /来源/);
    await store.setProfile("s", "u", document(), "admin");
    const original = (await store.find("s", "u")).person.profile;
    await store.importScene("target", "qq", await store.read("s"), "admin");
    const imported = Object.values((await store.read("target")).people)[0];
    assert.equal(imported.profile, original);
    assert.deepEqual(imported.structuredProfile, validateProfileDocument(document()));
});
test("overview follows current scene facts and rejects excessive topics, sparse lists and unrenderable dates", () => {
    const doc = document();
    doc.scenes = [
        {
            key: "scene",
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            nickname: "甲",
            recent: {
                from: 0,
                to: 1,
                coverage: "recorded_only",
                messageCount: 1,
                activeDays: 1,
                topics: ["编程"],
                emotions: ["轻松"],
                events: ["期末考试"],
                interactions: ["与乙讨论"],
                disagreements: ["作息安排"],
            },
            taboos: ["不谈成绩"],
            openers: ["聊聊项目"],
        },
    ];
    const canonical = validateProfileDocument(doc);
    for (const fact of ["编程", "轻松", "期末考试", "与乙讨论", "作息安排", "不谈成绩", "聊聊项目"]) assert.ok(canonical.overview.includes(fact));
    doc.scenes[0].recent.emotions = [];
    assert.ok(!validateProfileDocument(doc).overview.includes("轻松"));
    assert.throws(() => validateProfileDocument({ ...doc, preferences: Array.from({ length: 2 }) }));
    assert.throws(() =>
        validateProfileDocument({
            ...doc,
            scenes: [{ ...doc.scenes[0], recent: { ...doc.scenes[0].recent, topics: Array.from({ length: 6 }).fill("话题") } }],
        }),
    );
    assert.throws(() => validateProfileDocument({ ...doc, scenes: [{ ...doc.scenes[0], recent: { ...doc.scenes[0].recent, to: Number.MAX_SAFE_INTEGER } }] }));
});
test("profile proposals can cite currently linked accounts with each source binding checked", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const { person } = await store.recognize("s", "a", "甲");
    await store.recognize("s", "b", "乙");
    const binding = await store.bind("s", "b", person.id, 1, "admin");
    await store.capture("s", {
        id: "linked",
        userId: "b",
        name: "乙",
        text: "链接账号来源",
        timestamp: Date.now(),
        provenance: { platform: "qq", selfId: "bot", channelId: "g", messageId: "linked", personId: person.id, accountRevision: binding.bindingRevision ?? 0 },
    });
    const proposal = await store.propose("s", "a", document(), ["linked"], "model");
    assert.equal(proposal.evidence[0].userId, "b");
    await store.split("s", "b", "另一人", "admin");
    await assert.rejects(store.propose("s", "a", document(), ["linked"], "model"), /来源/);
});
test("stale summary version reports expiry before obsolete evidence lookup", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const initial = await store.recognize("s", "u", "甲");
    await store.setProfile("s", "u", "更正", "admin");
    await assert.rejects(
        store.propose("s", "u", document(), ["missing"], "model", {
            personId: initial.person.id,
            personRevision: initial.person.revision,
            accountRevision: initial.account.revision,
        }),
        /过期/,
    );
});
test("manual structured writes ground statistics and preserve quiet known scene guidance with empty current activity", async (t) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    t.onTestFinished(() => vi.useRealTimers());
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const initial = await store.recognize("s", "u", "甲");
    await store.capture("s", {
        id: "m",
        userId: "u",
        name: "甲",
        text: "内容",
        timestamp: Date.now(),
        provenance: {
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            messageId: "m",
            scene: "known",
            personId: initial.person.id,
            accountRevision: initial.account.bindingRevision ?? 0,
        },
    });
    const doc = document();
    doc.scenes = [
        {
            key: "known",
            platform: "fake",
            selfId: "fake",
            channelId: "fake",
            nickname: "fake",
            recent: {
                from: 0,
                to: 1,
                coverage: "recorded_only",
                messageCount: 999,
                activeDays: 8,
                topics: ["项目"],
                emotions: ["开心"],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: ["不谈成绩"],
            openers: ["聊项目"],
        },
    ];
    const set = await store.setProfile("s", "u", doc, "admin");
    assert.equal(set.structuredProfile.scenes[0].recent.messageCount, 1);
    assert.equal(set.structuredProfile.scenes[0].platform, "qq");
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    const refreshed = await store.setProfile("s", "u", set.structuredProfile, "admin");
    assert.equal(refreshed.structuredProfile.scenes[0].recent.messageCount, 0);
    assert.deepEqual(refreshed.structuredProfile.scenes[0].recent.topics, []);
    assert.deepEqual(refreshed.structuredProfile.scenes[0].recent.emotions, []);
    assert.deepEqual(refreshed.structuredProfile.scenes[0].taboos, ["不谈成绩"]);
    assert.ok(refreshed.structuredProfile.overview.includes("2026-10-24T12:00:00.000Z"));
    assert.ok(!refreshed.profile.includes("分场景近七日"));
});
test("review refreshes activity from persisted records at approval time", async (t) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    t.onTestFinished(() => vi.useRealTimers());
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const initial = await store.recognize("s", "u", "甲");
    const source = {
        userId: "u",
        name: "甲",
        text: "内容",
        timestamp: Date.now(),
        provenance: {
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            messageId: "m",
            scene: "known",
            personId: initial.person.id,
            accountRevision: initial.account.bindingRevision ?? 0,
        },
    };
    await store.capture("s", { ...source, id: "m" });
    const doc = document();
    doc.scenes = [
        {
            key: "known",
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            nickname: "甲",
            recent: {
                from: 0,
                to: 1,
                coverage: "recorded_only",
                messageCount: 999,
                activeDays: 8,
                topics: ["项目"],
                emotions: [],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: [],
            openers: [],
        },
    ];
    const proposal = await store.propose("s", "u", doc, ["m"], "model");
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    await store.capture("s", { ...source, id: "m2", timestamp: Date.now() });
    await store.review("s", proposal.id, true, "admin");
    const accepted = (await store.find("s", "u")).person;
    assert.equal(accepted.structuredProfile.scenes[0].recent.messageCount, 2);
    assert.equal(accepted.structuredProfile.scenes[0].recent.to, Date.now());
    const delayed = await store.propose("s", "u", accepted.structuredProfile, ["m2"], "model");
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    await store.capture("s", { ...source, id: "m3", timestamp: Date.now() });
    await store.review("s", delayed.id, true, "admin");
    const later = (await store.find("s", "u")).person.structuredProfile;
    assert.equal(later.scenes[0].recent.messageCount, 1);
    assert.deepEqual(later.scenes[0].recent.topics, []);
});
test("legacy profile proposals can cite linked accounts and manual unknown scenes are rejected", async (t) => {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "review");
    const { person } = await store.recognize("s", "a", "甲");
    await store.recognize("s", "b", "乙");
    const binding = await store.bind("s", "b", person.id, 1, "admin");
    await store.capture("s", {
        id: "linked",
        userId: "b",
        name: "乙",
        text: "内容",
        timestamp: Date.now(),
        provenance: {
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            messageId: "linked",
            scene: "known",
            personId: person.id,
            accountRevision: binding.bindingRevision ?? 0,
        },
    });
    const proposal = await store.propose("s", "a", "传统文本", ["linked"], "model");
    assert.equal(proposal.evidence[0].userId, "b");
    const doc = document();
    doc.scenes = [
        {
            key: "unknown",
            platform: "qq",
            selfId: "bot",
            channelId: "g",
            nickname: "甲",
            recent: {
                from: 0,
                to: 1,
                coverage: "recorded_only",
                messageCount: 100,
                activeDays: 8,
                topics: [],
                emotions: [],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: [],
            openers: [],
        },
    ];
    await assert.rejects(store.setProfile("s", "a", doc, "admin"), /来源/);
});
