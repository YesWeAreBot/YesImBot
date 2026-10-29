import { ErrorDefinitions } from "koishi-plugin-yesimbot";
import { expect, it } from "vitest";

import { apply } from "../src/index";
import { PersonStore, accountRef, mindScope, sceneKey } from "../src/store";
import { fixture } from "./helpers";

async function setup(t: any, shared: boolean) {
    const tools = new Map<string, any>();
    let permitted = true;
    const app = await fixture(t, (ctx) => {
        Object.defineProperty(ctx, "bots", {
            value: [{ platform: "onebot", selfId: "bot", session: (e: any) => ({ ...e, channelId: e.channel.id, isDirect: e.channel.type === 1 }) }],
        });
        ctx.set("yesimbot", {
            world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: (s: any) => permitted && s.channelId !== "blocked" },
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
    const session: any = { platform: "onebot", selfId: "bot", bot: { selfId: "bot" }, channelId: "g", userId: "u", isDirect: false };
    const scope = shared ? mindScope(session) : sceneKey(session);
    const store = new PersonStore(app.database, "auto");
    for (const uid of ["u", "v", "w"]) {
        await store.recognize(scope, shared ? accountRef("onebot", uid) : uid, uid);
    }
    return {
        app,
        store,
        scope,
        session,
        tool: tools.get("person_memory"),
        revoke: () => {
            permitted = false;
        },
    };
}

for (const shared of [false, true]) {
    it(`${shared ? "shared" : "scene"} bot lists then reads selected or all people without choosing by name`, async (t) => {
        const f = await setup(t, shared);
        f.session.send = () => Promise.resolve([]);
        const listed = await f.tool.execute({ session: f.session, action: "list" });
        expect(listed.status).toBe("success");
        expect(listed.result.total).toBe(3);
        expect(listed.result.items).toHaveLength(3);
        const multi = await f.tool.execute({ session: f.session, action: "read_many", account_ids: ["u", "v"], fields: "full" });
        expect(multi.status).toBe("success");
        expect(multi.result.total).toBe(2);
        expect(multi.result.items.map((p: any) => p.name).sort()).toEqual(["u", "v"]);
        const all = await f.tool.execute({ session: f.session, action: "read_many", all: true, limit: 1 });
        expect(all.status).toBe("success");
        expect(all.result.total).toBe(3);
        expect(all.result.hasMore).toBe(true);
        const next = await f.tool.execute({ session: f.session, action: "read_many", cursor: all.result.nextCursor });
        expect(next.status).toBe("success");
        expect(next.result.items[0].id).not.toBe(all.result.items[0].id);
        f.revoke();
        const denied = await f.tool.execute({ session: f.session, action: "read_many", cursor: all.result.nextCursor });
        expect(denied.status).toBe("error");
    });
    it(`${shared ? "shared" : "scene"} exposes structured profile schema and rejects ambiguous selection`, async (t) => {
        const f = await setup(t, shared);
        expect(f.tool.parameters.dict.profile.type).toBe("union");
        const result = await f.tool.execute({ session: f.session, action: "read_many", all: true, account_ids: ["u"] });
        expect(result.status).toBe("error");
    });
    it(`${shared ? "shared" : "scene"} accepts an atomic structured candidate and returns synchronized fields and overview`, async (t) => {
        const f = await setup(t, shared);
        await f.app.parallel("yesimbot/before-user-stimulus" as any, {
            ...f.session,
            author: { name: "u" },
            messageId: "evidence",
            content: "我喜欢 Python",
            timestamp: Date.now(),
        });
        const ref = shared ? accountRef("onebot", "u") : "u";
        const found = (await f.store.find(f.scope, ref))!;
        const source = (await f.store.sources(f.scope, ref))[0];
        const proposed = await f.tool.execute({
            session: f.session,
            action: "propose",
            account_id: "u",
            profile: {
                version: 1,
                background: [],
                goals: [],
                contexts: [],
                needs: [],
                preferences: ["喜欢 Python"],
                values: [],
                scenes: [],
                overview: "未经证实的额外事实",
            },
            message_ids: [source.id],
            person_id: found.person.id,
            person_revision: found.person.revision,
            account_revision: found.accounts[0].revision,
        });
        expect(proposed.status).toBe("success");
        const read = await f.tool.execute({ session: f.session, action: "read", account_id: "u" });
        expect(read.status).toBe("success");
        expect(read.result.structuredProfile.preferences).toEqual(["喜欢 Python"]);
        expect(read.result.overview).toContain("喜欢 Python");
        expect(read.result.overview).not.toContain("未经证实");
        expect(read.result.profile.endsWith(read.result.overview)).toBe(true);
    });
}

for (const action of ["propose", "propose_claim"])
    it(`classifies stale ${action} candidates through the plugin failure boundary`, async (t) => {
        const f = await setup(t, false);
        const found = (await f.store.find(f.scope, "u"))!;
        await f.store.setProfile(f.scope, "u", "管理员刚刚更新", "admin");
        await f.app.parallel("yesimbot/before-user-stimulus" as any, {
            ...f.session,
            author: { name: "u" },
            messageId: "fresh",
            content: "我喜欢 Python",
            timestamp: Date.now() + 1,
        });
        const source = (await f.store.profileSources(f.scope, "u", 0))[0];
        const result = await f.tool.execute({
            session: f.session,
            action,
            account_id: "u",
            profile: "旧候选",
            message_ids: [source.id],
            person_id: found.person.id,
            person_revision: found.person.revision,
            account_revision: found.accounts[0].revision,
            changes: [{ action: "support", category: "preferences", statement: "旧候选", messageIds: [source.id] }],
        });
        expect(result.status).toBe("error");
        expect(result.error).toMatchObject({ code: "PERSON_MEMORY.VERSION_CONFLICT", category: "conflict", retryable: false });
        expect(result.error.errorId).toMatch(/^[0-9a-f-]{36}$/);
        expect(JSON.stringify(result)).not.toMatch(/stack|cause|context/);
        expect((await f.store.find(f.scope, "u"))!.person.profile).toContain("管理员刚刚更新");
    });

it("preserves the conflict guard when an older core has no person error catalog", async (t) => {
    const f = await setup(t, false);
    const found = (await f.store.find(f.scope, "u"))!;
    await f.store.setProfile(f.scope, "u", "管理员刚刚更新", "admin");
    const catalog = ErrorDefinitions as any;
    const saved = catalog.PERSON_MEMORY;
    try {
        delete catalog.PERSON_MEMORY;
        await expect(
            f.store.propose(f.scope, "u", "旧候选", ["source"], "model", {
                personId: found.person.id,
                personRevision: found.person.revision,
                accountRevision: found.accounts[0].revision,
            }),
        ).rejects.toThrow("总结期间发生人工修改或身份变更，候选已过期");
        expect((await f.store.find(f.scope, "u"))!.person.profile).toContain("管理员刚刚更新");
    } finally {
        catalog.PERSON_MEMORY = saved;
    }
});
