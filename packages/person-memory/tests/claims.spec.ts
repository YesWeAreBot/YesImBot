import assert from "node:assert/strict";

import { test } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { fixture } from "./helpers";

async function setup(t: Parameters<typeof fixture>[0], mode: "auto" | "review" = "auto") {
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, mode);
    await store.recognize("s", "u", "甲");
    const source = async (id: string, root = id, userId = "u") => {
        const found = (await store.find("s", userId))!;
        await store.capture("s", {
            id,
            userId,
            name: "甲",
            text: id,
            timestamp: Date.now(),
            provenance: {
                platform: "qq",
                selfId: "bot",
                channelId: "c",
                messageId: root,
                personId: found.person.id,
                accountRevision: found.accounts.find((a) => a.userId === userId)!.bindingRevision ?? 0,
            },
        });
    };
    const propose = async (changes: any[]) => {
        const f = (await store.find("s", "u"))!;
        return store.proposeClaims("s", "u", changes, "model", {
            personId: f.person.id,
            personRevision: f.person.revision,
            accountRevision: f.accounts.find((a) => a.userId === "u")!.revision,
        });
    };
    return { ctx, store, source, propose };
}
test("claims deduplicate original roots and distinguish counter, revise and retire in projection", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("m");
    await propose([{ action: "support", category: "preferences", statement: "喜欢茶", messageIds: ["m"] }]);
    let [claim] = await store.readClaims("s", "u");
    assert.equal(claim.revision, 1);
    await source("recall", "m");
    await propose([{ action: "support", category: "preferences", statement: "喜欢茶", messageIds: ["recall"] }]);
    assert.equal((await store.readClaims("s", "u")).length, 1);
    assert.equal((await store.readClaims("s", "u"))[0].revision, 1);
    await source("n");
    await propose([{ action: "counter", claimId: claim.id, expectedRevision: 1, messageIds: ["n"] }]);
    claim = (await store.readClaims("s", "u"))[0];
    assert.equal(claim.status, "contested");
    assert.deepEqual((await store.find("s", "u"))!.person.structuredProfile!.preferences, []);
    await assert.rejects(propose([{ action: "revise", claimId: claim.id, expectedRevision: 2, statement: "喜欢咖啡", messageIds: ["m"] }]));
    await source("r");
    await propose([{ action: "revise", claimId: claim.id, expectedRevision: 2, statement: "喜欢咖啡", messageIds: ["r"] }]);
    assert.deepEqual((await store.find("s", "u"))!.person.structuredProfile!.preferences, ["喜欢咖啡"]);
    await propose([{ action: "retire", claimId: claim.id, expectedRevision: 3, messageIds: [] }]);
    await assert.rejects(propose([{ action: "support", claimId: claim.id, expectedRevision: 4, messageIds: ["r"] }]));
    assert.equal((await store.claimEvidence("s", "u", claim.id)).length, 3);
});
test("claim review snapshots survive source pruning and undo restores atomic projection", async (t) => {
    const { ctx, store, source, propose } = await setup(t, "review");
    await source("m");
    const proposal = await propose([{ action: "support", category: "goals", statement: "学中文", messageIds: ["m"] }]);
    assert.deepEqual(await store.readClaims("s", "u"), []);
    await ctx.database.remove("person_memory.sources", {});
    await store.review("s", proposal.id, true, "admin");
    assert.deepEqual((await store.find("s", "u"))!.person.structuredProfile!.goals, ["学中文"]);
    await store.revert("s", (await store.history("s"))[0].id, "admin");
    assert.deepEqual(await store.readClaims("s", "u"), []);
});
test("claims enforce ownership, mode, locks and full replacement barriers", async (t) => {
    const { store, source, propose } = await setup(t);
    await store.recognize("s", "v", "乙");
    await source("foreign", "foreign", "v");
    await assert.rejects(propose([{ action: "support", category: "goals", statement: "错", messageIds: ["foreign"] }]));
    await source("m");
    await propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]);
    await assert.rejects(store.propose("s", "u", "覆写", ["m"], "model"));
    await store.lock("s", "u", true, "admin");
    await assert.rejects(propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]));
    await store.lock("s", "u", false, "admin");
    await store.settings("s", { mode: "off" }, "admin");
    await assert.rejects(propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]));
});
test("scoped proposal request receipts survive retries after the accepted version changes", async (t) => {
    const { store, source } = await setup(t);
    await source("m");
    const f = (await store.find("s", "u"))!;
    const expected = { personId: f.person.id, personRevision: f.person.revision, accountRevision: f.accounts[0].revision };
    const first = await store.propose("s", "u", "档案", ["m"], "worker", expected, () => true, "job:1");
    await store.rename("s", "u", "新称呼", "admin");
    const retry = await store.propose("s", "u", "档案", ["m"], "worker", expected, () => true, "job:1");
    assert.equal(retry.id, first.id);
    assert.equal((await store.history("s", 20)).filter((a) => a.action === "proposal").length, 1);
});
test("clear and identity remapping retire records without carrying active claims or reviving old roots", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("m");
    await propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]);
    await store.setProfile("s", "u", "", "admin");
    assert.equal((await store.readClaims("s", "u"))[0].status, "retired");
    await assert.rejects(propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]));
    await store.split("s", "u", "新人物", "admin");
    assert.deepEqual(await store.readClaims("s", "u"), []);
});
test("scene claims project recorded metadata and never invent aggregate counts", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("m");
    await propose([{ action: "support", category: "taboos", scene: JSON.stringify(["qq", "bot", "c"]), statement: "不谈收入", messageIds: ["m"] }]);
    const scene = (await store.find("s", "u"))!.person.structuredProfile!.scenes[0];
    assert.deepEqual(scene.taboos, ["不谈收入"]);
    assert.equal(scene.recent.messageCount, 1);
});
test("retired claims require evidence captured after retirement rather than an unused old source", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("m");
    await source("old-unused");
    await propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]);
    const claim = (await store.readClaims("s", "u"))[0];
    await new Promise((resolve) => setTimeout(resolve, 2));
    await propose([{ action: "retire", claimId: claim.id, expectedRevision: 1, messageIds: [] }]);
    await assert.rejects(propose([{ action: "revise", claimId: claim.id, expectedRevision: 2, statement: "目标", messageIds: ["old-unused"] }]));
});
test("linked account evidence is validated against its own binding and cannot follow a split", async (t) => {
    const { store, source, propose } = await setup(t);
    await store.recognize("s", "v", "乙");
    const target = (await store.find("s", "u"))!.person;
    await store.bind("s", "v", target.id, 1, "admin");
    await source("linked", "linked", "v");
    await propose([{ action: "support", category: "preferences", statement: "茶", messageIds: ["linked"] }]);
    await store.split("s", "v", "乙", "admin");
    assert.equal((await store.readClaims("s", "u"))[0].status, "retired");
    await assert.rejects(propose([{ action: "support", category: "preferences", statement: "茶", messageIds: ["linked"] }]));
});
test("fresh support alone cannot reactivate retired claims and observer bots are not independent roots", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("m");
    await propose([{ action: "support", category: "preferences", statement: "茶", messageIds: ["m"] }]);
    let claim = (await store.readClaims("s", "u"))[0];
    const f = (await store.find("s", "u"))!;
    await store.capture("s", {
        id: "other-bot",
        userId: "u",
        name: "甲",
        text: "茶",
        timestamp: Date.now(),
        provenance: {
            platform: "qq",
            selfId: "second",
            channelId: "c",
            messageId: "m",
            personId: f.person.id,
            accountRevision: f.accounts[0].bindingRevision ?? 0,
        },
    });
    await propose([{ action: "support", claimId: claim.id, expectedRevision: 1, messageIds: ["other-bot"] }]);
    assert.equal((await store.readClaims("s", "u"))[0].revision, 1);
    await propose([{ action: "retire", claimId: claim.id, expectedRevision: 1, messageIds: [] }]);
    await source("fresh");
    await assert.rejects(propose([{ action: "support", category: "preferences", statement: "茶", messageIds: ["fresh"] }]));
    await propose([{ action: "revise", claimId: claim.id, expectedRevision: 2, statement: "茶", messageIds: ["fresh"] }]);
    claim = (await store.readClaims("s", "u"))[0];
    assert.equal(claim.status, "active");
});
test("pending claims honor pause and revision guards at approval and cancellation leaves no accepted ledger", async (t) => {
    const { store, source, propose } = await setup(t, "review");
    await source("m");
    const candidate = await propose([{ action: "support", category: "needs", statement: "休息", messageIds: ["m"] }]);
    await store.settings("s", { paused: true }, "admin");
    await assert.rejects(store.review("s", candidate.id, true, "admin"));
    assert.deepEqual(await store.readClaims("s", "u"), []);
    await store.settings("s", { paused: false }, "admin");
    await store.rename("s", "u", "改名", "admin");
    await assert.rejects(store.review("s", candidate.id, true, "admin"));
    const f = (await store.find("s", "u"))!;
    await assert.rejects(
        store.proposeClaims(
            "s",
            "u",
            [{ action: "support", category: "needs", statement: "休息", messageIds: ["m"] }],
            "model",
            { personId: f.person.id, personRevision: f.person.revision, accountRevision: f.accounts[0].revision },
            () => false,
        ),
    );
    assert.deepEqual(await store.readClaims("s", "u"), []);
});
test("archive and import never transfer the managed ledger to a fresh identity", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("m");
    await propose([{ action: "support", category: "values", statement: "诚实", messageIds: ["m"] }]);
    const old = await store.read("s");
    await store.importScene("new", "qq", old, "admin");
    const imported = Object.values((await store.read("new")).people)[0];
    assert.equal(imported.claims, undefined);
    assert.equal(imported.profile, "");
    const current = (await store.find("s", "u"))!.person;
    await store.archive("s", "u", "admin", current.revision);
    await store.recognize("s", "u", "再见");
    assert.deepEqual(await store.readClaims("s", "u"), []);
});
test("merge retires active managed claims while retaining the target unmanaged structured facts", async (t) => {
    const { store, source, propose } = await setup(t);
    await store.setProfile(
        "s",
        "u",
        { version: 1, background: ["遗留背景"], goals: [], contexts: [], needs: [], preferences: [], values: [], scenes: [], overview: "" },
        "admin",
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    await source("m");
    await propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]);
    await store.recognize("s", "v", "乙");
    await store.merge("s", "v", "u", "admin");
    const merged = (await store.find("s", "u"))!.person;
    assert.equal(merged.claims![0].status, "retired");
    assert.deepEqual(merged.structuredProfile!.goals, []);
    assert.deepEqual(merged.structuredProfile!.background, ["遗留背景"]);
});
test("every scene claim citation must belong to that scene even when both scenes are already known", async (t) => {
    const { store, source, propose } = await setup(t);
    await source("a");
    const f = (await store.find("s", "u"))!;
    await store.capture("s", {
        id: "b",
        userId: "u",
        name: "甲",
        text: "群二",
        timestamp: Date.now(),
        provenance: {
            platform: "qq",
            selfId: "bot",
            channelId: "second",
            messageId: "b",
            personId: f.person.id,
            accountRevision: f.accounts[0].bindingRevision ?? 0,
        },
    });
    const scene = JSON.stringify(["qq", "bot", "second"]);
    await propose([{ action: "support", category: "taboos", scene, statement: "收入", messageIds: ["b"] }]);
    await assert.rejects(propose([{ action: "support", category: "openers", scene, statement: "问好", messageIds: ["a"] }]));
});

test("first claim retains plaintext legacy snapshot and explicit manual edits retire claims and clear the old snapshot", async (t) => {
    const { store, source, propose } = await setup(t);
    await store.setProfile("s", "u", "旧版自由文本", "admin");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await source("m");
    await propose([{ action: "support", category: "goals", statement: "目标", messageIds: ["m"] }]);
    assert.equal((await store.find("s", "u"))!.person.legacyProfile, "旧版自由文本");
    await store.setProfile("s", "u", "管理员改正后的自由文本", "admin");
    let p = (await store.find("s", "u"))!.person;
    assert.equal(p.profile, "管理员改正后的自由文本");
    assert.equal(p.legacyProfile, undefined);
    assert.equal(p.claims![0].status, "retired");
    await store.setProfile("s", "u", "", "admin");
    p = (await store.find("s", "u"))!.person;
    assert.equal(p.legacyProfile, undefined);
    assert.equal(p.profile, "");
});
test("claim request receipts replay before stale version checks without duplicating accepted revisions", async (t) => {
    const { store, source } = await setup(t);
    await source("m");
    const f = (await store.find("s", "u"))!;
    const expected = { personId: f.person.id, personRevision: f.person.revision, accountRevision: f.accounts[0].revision };
    const changes = [{ action: "support" as const, category: "goals" as const, statement: "学习", messageIds: ["m"] }];
    const first = await store.proposeClaims("s", "u", changes, "worker", expected, () => true, "claim-job:1");
    const retry = await store.proposeClaims("s", "u", changes, "worker", expected, () => true, "claim-job:1");
    assert.equal(retry.id, first.id);
    assert.equal((await store.readClaims("s", "u"))[0].revision, 1);
    assert.equal((await store.history("s", 20)).filter((a) => a.action === "claim-proposal").length, 1);
});
test("scoped Koishi database views share physical table identity and serialize concurrent request receipts", async (t) => {
    const { ctx, store, source } = await setup(t);
    await source("m");
    const sibling = ctx.extend({});
    const one = ctx.database;
    const two = sibling.database;
    assert.notEqual(one, two);
    assert.equal(one.tables, two.tables);
    const secondStore = new PersonStore(two, "auto");
    const f = (await store.find("s", "u"))!;
    const expected = { personId: f.person.id, personRevision: f.person.revision, accountRevision: f.accounts[0].revision };
    const changes = [{ action: "support" as const, category: "goals" as const, statement: "共同请求", messageIds: ["m"] }];
    const [a, b] = await Promise.all([
        store.proposeClaims("s", "u", changes, "worker", expected, () => true, "same-job"),
        secondStore.proposeClaims("s", "u", changes, "worker", expected, () => true, "same-job"),
    ]);
    assert.equal(a.id, b.id);
    assert.equal((await store.readClaims("s", "u")).length, 1);
});
