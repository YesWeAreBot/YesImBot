import { expect, it, vi } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { fixture } from "./helpers";

async function probe(t: any) {
    let clock = 2_000_000_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    t.onTestFinished(() => now.mockRestore());
    const ctx = await fixture(t, registerModels);
    const store = new PersonStore(ctx.database, "auto");
    await store.recognize("review-probe", "u", "person");
    const capture = async (id: string, channelId = "c") => {
        const found = (await store.find("review-probe", "u"))!;
        await store.capture("review-probe", {
            id,
            userId: "u",
            name: "person",
            text: id,
            timestamp: clock,
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
        const found = (await store.find("review-probe", "u"))!;
        return store.proposeClaims("review-probe", "u", changes, "model", {
            personId: found.person.id,
            personRevision: found.person.revision,
            accountRevision: found.accounts[0].revision,
        });
    };
    return { store, capture, propose, tick: () => clock++, claims: () => store.readClaims("review-probe", "u") };
}

it("review probe: blank scene must not create a second active copy of a retired global claim", async (t) => {
    const f = await probe(t);
    await f.capture("m");
    await f.propose([{ action: "support", category: "goals", statement: "old belief", messageIds: ["m"] }]);
    const [claim] = await f.claims();
    await f.propose([{ action: "retire", claimId: claim.id, expectedRevision: 1, messageIds: [] }]);
    f.tick();
    await f.capture("fresh");
    await expect(f.propose([{ action: "support", category: "goals", scene: "", statement: "old belief", messageIds: ["fresh"] }])).rejects.toThrow("场景");
});

it("review probe: unused pre-retirement evidence from the same millisecond must not restore a claim", async (t) => {
    const f = await probe(t);
    await f.capture("m");
    await f.capture("older-unused");
    await f.propose([{ action: "support", category: "goals", statement: "old belief", messageIds: ["m"] }]);
    const [claim] = await f.claims();
    await f.propose([{ action: "retire", claimId: claim.id, expectedRevision: 1, messageIds: [] }]);
    await expect(
        f.propose([{ action: "revise", claimId: claim.id, expectedRevision: 2, statement: "old belief", messageIds: ["older-unused"] }]),
    ).rejects.toThrow("新的独立原始消息");
});

it("review probe: clearing a scene claim must allow a later global claim sourced in a different scene", async (t) => {
    const f = await probe(t);
    await f.capture("m", "first");
    await f.propose([{ action: "support", category: "taboos", scene: JSON.stringify(["qq", "bot", "first"]), statement: "old taboo", messageIds: ["m"] }]);
    f.tick();
    await f.store.setProfile("review-probe", "u", "", "admin");
    f.tick();
    await f.capture("fresh", "second");
    await expect(f.propose([{ action: "support", category: "goals", statement: "new goal", messageIds: ["fresh"] }])).resolves.toMatchObject({
        state: "accepted",
    });
});

it("review probe: a new claim must not make identity-invalidated legacy structured facts current again", async (t) => {
    const f = await probe(t);
    await f.store.setProfile(
        "review-probe",
        "u",
        { version: 1, background: ["unverified legacy background"], goals: [], contexts: [], needs: [], preferences: [], values: [], scenes: [], overview: "" },
        "admin",
    );
    await f.store.recognize("review-probe", "v", "other person");
    const target = (await f.store.find("review-probe", "u"))!.person;
    f.tick();
    await f.store.bind("review-probe", "v", target.id, 1, "admin");
    expect((await f.store.find("review-probe", "u"))!.person.stale).toBe(true);
    f.tick();
    await f.capture("fresh");
    await f.propose([{ action: "support", category: "goals", statement: "new supported goal", messageIds: ["fresh"] }]);
    const updated = (await f.store.find("review-probe", "u"))!.person;
    expect(updated.stale || !updated.structuredProfile?.background.includes("unverified legacy background")).toBe(true);
});
