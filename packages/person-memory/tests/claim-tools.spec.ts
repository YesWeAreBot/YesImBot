import { expect, it } from "vitest";

import { apply } from "../src/index";
import { PersonStore, accountRef, mindScope, sceneKey } from "../src/store";
import { fixture } from "./helpers";

async function setup(t: any, shared: boolean) {
    const tools = new Map<string, any>();
    let allowed = true;
    const app = await fixture(t, (ctx) => {
        Object.defineProperty(ctx, "bots", {
            value: [
                {
                    platform: "onebot",
                    selfId: "bot",
                    session: (e: any) => ({ ...e, channelId: e.channel.id, isDirect: e.channel.type === 1, userId: e.user?.id || e.userId }),
                },
            ],
        });
        ctx.set("yesimbot", {
            world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: () => allowed },
            tool: {
                capabilities: { trustedToolSession: 1 },
                registerTool: (tool: any) => {
                    tools.set(tool.name, tool);
                    return () => tools.delete(tool.name);
                },
                unregisterTool() {},
            },
            prompt: { inject: () => () => {} },
        });
        ctx.plugin({
            inject: ["database", "yesimbot"],
            apply: (ctx: any) =>
                apply(ctx, {
                    enabled: true,
                    mode: "auto",
                    sharedMemory: shared,
                    modelGroup: "",
                    summaryThreshold: 6,
                    cooldownSeconds: 600,
                    timeoutSeconds: 30,
                    maxQueue: 32,
                    recallScope: "mind",
                }),
        });
    });
    const session: any = { platform: "onebot", selfId: "bot", bot: { selfId: "bot" }, channelId: "group", userId: "u", isDirect: false };
    for (const [i, text] of ["我喜欢 Python", "其实我现在更喜欢 Rust"].entries())
        await app.parallel("yesimbot/before-user-stimulus" as any, {
            ...session,
            author: { name: "User" },
            messageId: `m${i}`,
            content: text,
            timestamp: Date.now() + i - 10,
        });
    const scope = shared ? mindScope(session) : sceneKey(session);
    const ref = shared ? accountRef("onebot", "u") : "u";
    const store = new PersonStore(app.database, "auto");
    await store.setProfile(scope, ref, "旧版保留内容", "admin");
    // setProfile creates a correction watermark, so use fresh post-correction evidence.
    await new Promise((resolve) => setTimeout(resolve, 2));
    for (const [i, text] of ["我喜欢 Python", "其实我现在更喜欢 Rust"].entries())
        await app.parallel("yesimbot/before-user-stimulus" as any, {
            ...session,
            author: { name: "User" },
            messageId: `fresh${i}`,
            content: text,
            timestamp: Date.now(),
        });
    return {
        store,
        scope,
        ref,
        session,
        tool: tools.get("person_memory"),
        revoke: () => {
            allowed = false;
        },
    };
}

for (const shared of [false, true]) {
    it(`${shared ? "shared" : "scene"} model maintains individual claims and reads their original evidence`, async (t) => {
        const f = await setup(t, shared);
        const sources = await f.store.profileSources(f.scope, f.ref, 0);
        const source = sources.find((e) => e.text === "我喜欢 Python")!;
        const opposing = sources.find((e) => e.text.includes("Rust"))!;
        const found = (await f.store.find(f.scope, f.ref))!;
        const proposed = await f.tool.execute({
            session: f.session,
            action: "propose_claim",
            account_id: "u",
            person_id: found.person.id,
            person_revision: found.person.revision,
            account_revision: found.accounts[0].revision,
            changes: [{ action: "support", category: "preferences", statement: "喜欢 Python", messageIds: [source.id] }],
        });
        expect(proposed.status).toBe("success");
        expect(proposed.result).not.toHaveProperty("claims");
        expect(proposed.result).not.toHaveProperty("evidence");
        const listed = await f.tool.execute({ session: f.session, action: "claims", account_id: "u" });
        expect(listed.status).toBe("success");
        expect(listed.result.items).toHaveLength(1);
        const claim = listed.result.items[0];
        expect(claim.statement).toBe("喜欢 Python");
        const current = (await f.store.find(f.scope, f.ref))!;
        expect(current.person.profile).toContain("喜欢 Python");
        expect(current.person.legacyProfile).toBe("旧版保留内容");
        const counter = await f.tool.execute({
            session: f.session,
            action: "propose_claim",
            account_id: "u",
            person_id: current.person.id,
            person_revision: current.person.revision,
            account_revision: current.accounts[0].revision,
            changes: [{ action: "counter", claimId: claim.id, expectedRevision: claim.revision, messageIds: [opposing.id] }],
        });
        expect(counter.status).toBe("success");
        expect((await f.store.find(f.scope, f.ref))!.person.structuredProfile!.preferences).toEqual([]);
        const evidence = await f.tool.execute({ session: f.session, action: "claim_evidence", account_id: "u", claim_id: claim.id });
        expect(evidence.status).toBe("success");
        expect(evidence.result.items.map((e: any) => e.text)).toEqual(expect.arrayContaining(["我喜欢 Python", "其实我现在更喜欢 Rust"]));
        f.revoke();
        expect((await f.tool.execute({ session: f.session, action: "claim_evidence", account_id: "u", claim_id: claim.id })).status).toBe("error");
    });
}
