import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { visibleProfile } from "../src/profile-tools";
import { PersonStore, registerModels } from "../src/store";
import { fixture } from "./helpers";

async function setup(t: Parameters<typeof fixture>[0], mode: "auto" | "review" = "auto") {
    let now = 2_000_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    t.onTestFinished(() => clock.mockRestore());
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, mode);
    await store.recognize("s", "u", "User");
    const source = async (id: string, channelId = "c") => {
        const found = (await store.find("s", "u"))!;
        await store.capture("s", {
            id,
            userId: "u",
            name: "User",
            text: id,
            timestamp: now,
            provenance: {
                platform: "qq",
                selfId: "bot",
                channelId,
                messageId: id,
                personId: found.person.id,
                accountRevision: found.accounts[0].bindingRevision ?? 0,
            },
        });
    };
    const propose = async (changes: any[]) => {
        const found = (await store.find("s", "u"))!;
        return store.proposeClaims("s", "u", changes, "model", {
            personId: found.person.id,
            personRevision: found.person.revision,
            accountRevision: found.accounts[0].revision,
        });
    };
    return {
        ctx,
        store,
        source,
        propose,
        advance: (ms = 1) => {
            now += ms;
        },
        now: () => now,
    };
}

for (const operation of ["bind", "split", "unbind"] as const)
    for (const manual of ["administrator corrected text", ""])
        test(`${operation} preserves ${manual ? "manual text" : "a manual clear"} after retiring claims`, async (t) => {
            const f = await setup(t);
            await f.source("old");
            await f.propose([{ action: "support", category: "goals", statement: "superseded model conclusion", messageIds: ["old"] }]);
            const id = (await f.store.find("s", "u"))!.person.id;
            f.advance();
            await f.store.setProfile("s", "u", manual, "admin");
            f.advance();
            if (operation === "bind") {
                const target = await f.store.recognize("s", "v", "Target");
                await f.store.bind("s", "u", target.person.id, 1, "admin");
            } else if (operation === "split") await f.store.split("s", "u", "Corrected", "admin");
            else await f.store.unbind("s", "u", "admin");
            const person = (await f.store.find("s", id))!.person;
            assert.equal(person.profile, manual);
            assert.equal(person.structuredProfile, undefined);
            assert.ok(person.identityChanged);
            if (manual) assert.ok(person.stale);
            assert.ok(person.claims!.every((claim) => claim.status === "retired"));
        });

for (const manualRole of ["source", "target"] as const)
    test(`merge preserves a ${manualRole} manual correction without reviving model conclusions`, async (t) => {
        const f = await setup(t);
        await f.source("old");
        await f.propose([{ action: "support", category: "goals", statement: "superseded model conclusion", messageIds: ["old"] }]);
        f.advance();
        await f.store.setProfile("s", "u", "administrator corrected text", "admin");
        await f.store.recognize("s", "v", "Other");
        await f.store.setProfile("s", "v", "other administrator text", "admin");
        await f.store.merge("s", manualRole === "source" ? "u" : "v", manualRole === "source" ? "v" : "u", "admin");
        const person = (await f.store.find("s", "u"))!.person;
        assert.ok(person.profile.includes("administrator corrected text"));
        assert.ok(person.profile.includes("other administrator text"));
        assert.ok(!person.profile.includes("superseded model conclusion"));
        assert.equal(person.structuredProfile, undefined);
        assert.ok(person.identityChanged);
        assert.ok(person.stale);
    });

test("merging manual text into a managed target retains it as stale text after retiring the target claims", async (t) => {
    const f = await setup(t);
    await f.source("old");
    await f.propose([{ action: "support", category: "goals", statement: "superseded model conclusion", messageIds: ["old"] }]);
    await f.store.recognize("s", "v", "Other");
    await f.store.setProfile("s", "v", "administrator corrected text", "admin");
    await f.store.merge("s", "v", "u", "admin");
    const person = (await f.store.find("s", "u"))!.person;
    assert.equal(person.profile, "administrator corrected text");
    assert.equal(person.structuredProfile, undefined);
    assert.ok(person.claims!.every((claim) => claim.status === "retired"));
    assert.ok(person.stale);
    assert.ok(person.identityChanged);
});

test("accepting a global claim does not reinsert expired scene emotions into the refreshed activity window", async (t) => {
    const f = await setup(t);
    await f.source("old");
    await f.propose([{ action: "support", category: "emotions", scene: JSON.stringify(["qq", "bot", "c"]), statement: "sad today", messageIds: ["old"] }]);
    f.advance(8 * 86400000);
    await f.source("fresh", "other");
    await f.propose([{ action: "support", category: "goals", statement: "new goal", messageIds: ["fresh"] }]);
    const person = (await f.store.find("s", "u"))!.person;
    const scene = person.structuredProfile!.scenes[0];
    assert.deepEqual(scene.recent.emotions, []);
    assert.equal(scene.recent.messageCount, 0);
    assert.equal(scene.recent.to, f.now());
    assert.deepEqual(person.structuredProfile!.goals, ["new goal"]);
    assert.equal(person.claims![0].status, "active", "the evidence ledger remains available even when the recent projection expires");
});

for (const prune of [false, true])
    test(`delayed claim approval regrounds the final snapshot ${prune ? "after source pruning" : "despite new activity"}`, async (t) => {
        const f = await setup(t, "review");
        await f.source("old");
        const proposal = await f.propose([
            { action: "support", category: "emotions", scene: JSON.stringify(["qq", "bot", "c"]), statement: "sad today", messageIds: ["old"] },
            { action: "support", category: "taboos", scene: JSON.stringify(["qq", "bot", "c"]), statement: "avoid income questions", messageIds: ["old"] },
        ]);
        f.advance(8 * 86400000);
        if (prune) await f.ctx.database.remove("person_memory.sources", {});
        else await f.source("fresh");
        await f.store.review("s", proposal.id, true, "admin");
        const scene = (await f.store.find("s", "u"))!.person.structuredProfile!.scenes[0];
        assert.deepEqual(scene.recent.emotions, []);
        assert.equal(scene.recent.from, f.now() - 7 * 86400000);
        assert.equal(scene.recent.to, f.now());
        assert.equal(scene.recent.messageCount, prune ? 0 : 1);
        assert.deepEqual(scene.taboos, ["avoid income questions"]);
    });

for (const category of ["topics", "emotions", "events", "interactions", "disagreements"] as const)
    test(`fresh activity in the same scene does not refresh an expired ${category} claim`, async (t) => {
        const f = await setup(t);
        await f.source("old");
        await f.propose([
            { action: "support", category, scene: JSON.stringify(["qq", "bot", "c"]), statement: "old scene conclusion", messageIds: ["old"] },
            { action: "support", category: "preferences", statement: "long-term preference", messageIds: ["old"] },
            { action: "support", category: "taboos", scene: JSON.stringify(["qq", "bot", "c"]), statement: "long-term boundary", messageIds: ["old"] },
        ]);
        f.advance(8 * 86400000);
        await f.source("fresh");
        await f.propose([{ action: "support", category: "goals", statement: "new goal", messageIds: ["fresh"] }]);
        const person = (await f.store.find("s", "u"))!.person;
        assert.deepEqual(person.structuredProfile!.scenes[0].recent[category], []);
        assert.deepEqual(visibleProfile(person, () => true).structuredProfile!.scenes[0].recent[category], []);
        assert.equal(person.structuredProfile!.scenes[0].recent.messageCount, 1);
        assert.deepEqual(person.structuredProfile!.preferences, ["long-term preference"]);
        assert.deepEqual(person.structuredProfile!.scenes[0].taboos, ["long-term boundary"]);

        const claim = person.claims![0];
        await f.propose([{ action: "support", claimId: claim.id, expectedRevision: claim.revision, messageIds: ["fresh"] }]);
        assert.deepEqual((await f.store.find("s", "u"))!.person.structuredProfile!.scenes[0].recent[category], ["old scene conclusion"]);
    });

test("recent evidence for a superseded statement does not make a revision using old evidence recent", async (t) => {
    const f = await setup(t);
    await f.source("old-unused");
    f.advance(8 * 86400000);
    await f.source("fresh");
    await f.propose([
        { action: "support", category: "emotions", scene: JSON.stringify(["qq", "bot", "c"]), statement: "fresh statement", messageIds: ["fresh"] },
    ]);
    const claim = (await f.store.readClaims("s", "u"))[0];
    await f.propose([
        { action: "revise", claimId: claim.id, expectedRevision: claim.revision, statement: "old evidence revision", messageIds: ["old-unused"] },
    ]);
    const person = (await f.store.find("s", "u"))!.person;
    assert.deepEqual(person.structuredProfile!.scenes[0].recent.emotions, []);
    assert.equal(person.claims![0].statement, "old evidence revision");
});
