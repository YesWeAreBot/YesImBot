import { Argv } from "koishi";
import { expect, test, vi } from "vitest";

import { ContinuityStore } from "../src/continuity";
import { apply } from "../src/index";
import type { ProfileDocument } from "../src/profile";
import { PersonStore, accountRef, mindScope, sceneKey } from "../src/store";
import { fixture } from "./helpers";

async function setup(t: any, shared = true, recallScope = "current") {
    const tools = new Map<string, any>();
    let inject: any;
    let permitted = true;
    let permitDirect = false;
    const app = await fixture(t, (ctx) => {
        Object.defineProperty(ctx, "bots", {
            value: [{ platform: "onebot", selfId: "bot", session: (e: any) => ({ ...e, channelId: e.channel.id, isDirect: e.channel.type === 1 }) }],
        });
        ctx.set("yesimbot", {
            world: {
                capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 },
                isChannelAllowed: (s: any) => permitted && (!s.isDirect || permitDirect),
            },
            tool: {
                capabilities: { trustedToolSession: 1 },
                registerTool: (tool: any) => {
                    tools.set(tool.name, tool);
                    return () => tools.delete(tool.name);
                },
                unregisterTool() {},
            },
            prompt: {
                inject: (_name: string, _order: number, fn: any) => {
                    inject = fn;
                    return () => {};
                },
            },
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
                    recallScope,
                } as any),
        });
    });
    t.onTestFinished(() => vi.restoreAllMocks());
    const session: any = { platform: "onebot", selfId: "bot", bot: { selfId: "bot" }, channelId: "g", userId: "u", isDirect: false, send() {} };
    const scope = shared ? mindScope(session) : sceneKey(session);
    const ref = shared ? accountRef("onebot", "u") : "u";
    const store = new PersonStore(app.database, "auto");
    await store.recognize(scope, ref, "known person");
    await store.setProfile(scope, ref, "original profile", "admin");
    const tool = tools.get("person_memory");
    return {
        app,
        session,
        scope,
        ref,
        store,
        tool,
        prompt: () => inject({ session }),
        revoke: () => {
            permitted = false;
        },
        enableDirect: () => {
            permitDirect = true;
        },
    };
}
function documentFor(session: any, scenes: Array<{ channelId: string; isDirect?: boolean; topic: string }>): ProfileDocument {
    return {
        version: 1,
        background: ["domain shared background"],
        goals: [],
        contexts: [],
        needs: [],
        preferences: [],
        values: [],
        overview: "",
        scenes: scenes.map((scene) => ({
            key: sceneKey({ ...session, ...scene }),
            platform: session.platform,
            selfId: session.selfId,
            channelId: scene.channelId,
            nickname: "known person",
            recent: {
                from: 0,
                to: 0,
                coverage: "recorded_only",
                messageCount: 1,
                activeDays: 1,
                topics: [scene.topic],
                emotions: [],
                events: [],
                interactions: [],
                disagreements: [],
            },
            taboos: [],
            openers: [],
        })),
    };
}

async function setDocument(f: Awaited<ReturnType<typeof setup>>, document: ProfileDocument) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const found = (await f.store.find(f.scope, f.ref))!;
    for (const [index, scene] of document.scenes.entries()) {
        await f.store.capture(f.scope, {
            id: `source-${index}`,
            userId: f.ref,
            name: "known person",
            text: scene.recent.topics.join(" "),
            timestamp: Date.now(),
            provenance: {
                platform: scene.platform,
                selfId: scene.selfId,
                channelId: scene.channelId,
                scene: scene.key,
                messageId: `source-${index}`,
                personId: found.person.id,
                accountRevision: found.accounts[0].bindingRevision ?? 0,
            },
        });
    }
    await f.store.setProfile(f.scope, f.ref, document, "admin");
}

test("current-scope read, search, catalog and prompt omit other scenes while retaining shared background", async (t) => {
    const f = await setup(t);
    await setDocument(
        f,
        documentFor(f.session, [
            { channelId: "g", topic: "visible-topic" },
            { channelId: "other", topic: "hidden-topic" },
        ]),
    );
    for (const args of [
        { action: "read", account_id: "u" },
        { action: "search", query: "known" },
        { action: "list" },
        { action: "read_many", all: true, fields: "full" },
    ]) {
        const result = await f.tool.execute({ session: f.session, ...args });
        expect(result.status).toBe("success");
        expect(JSON.stringify(result)).toContain("domain shared background");
        expect(JSON.stringify(result)).not.toContain("hidden-topic");
    }
    const hiddenSearch = await f.tool.execute({ session: f.session, action: "search", query: "hidden-topic" });
    expect(hiddenSearch.result).toEqual([]);
    const prompt = await f.prompt();
    expect(prompt).toContain("visible-topic");
    expect(prompt).not.toContain("hidden-topic");
});

test("private scene with colliding channel ID cannot cross into public profile queries", async (t) => {
    const f = await setup(t);
    await setDocument(
        f,
        documentFor(f.session, [
            { channelId: "g", topic: "public-topic" },
            { channelId: "g", isDirect: true, topic: "private-secret" },
        ]),
    );
    for (const args of [
        { action: "read", account_id: "u" },
        { action: "search", query: "known" },
        { action: "list" },
        { action: "read_many", all: true, fields: "full" },
    ]) {
        const result = await f.tool.execute({ session: f.session, ...args });
        expect(result.status).toBe("success");
        expect(JSON.stringify(result)).not.toContain("private-secret");
    }
    expect(await f.prompt()).not.toContain("private-secret");
});

for (const shared of [false, true]) {
    for (const action of ["read", "search", "history"]) {
        test(`${shared ? "shared" : "scene"} ${action} rejects permission revoked during the last state read`, async (t) => {
            const f = await setup(t, shared);
            const original = PersonStore.prototype.read;
            const boundary = shared ? (action === "read" ? 4 : action === "search" ? 2 : 3) : 3;
            let reads = 0;
            let revoked = false;
            vi.spyOn(PersonStore.prototype, "read").mockImplementation(async function (scope) {
                const result = await original.call(this, scope);
                if (++reads === boundary) {
                    f.revoke();
                    revoked = true;
                }
                return result;
            });
            const result = await f.tool.execute({ session: f.session, action, account_id: "u", query: "known" });
            expect(revoked).toBe(true);
            expect(result.status).toBe("error");
        });
    }
    test(`${shared ? "shared" : "scene"} prompt suppresses content if its session changes during reads`, async (t) => {
        const f = await setup(t, shared);
        const original = PersonStore.prototype.read;
        vi.spyOn(PersonStore.prototype, "read").mockImplementation(async function (scope) {
            const result = await original.call(this, scope);
            f.session.channelId = "different";
            return result;
        });
        expect(await f.prompt()).toBe("");
    });
}

for (const shared of [false, true]) {
    test(`${shared ? "shared" : "scene"} structured edit parses raw JSON and plain edit clears the structure`, async (t) => {
        const f = await setup(t, shared);
        f.session.user = { authority: 3 };
        const command = f.app.$commander.resolve("people.edit_json")!;
        expect(command).toBeDefined();
        const document = documentFor(f.session, []);
        document.preferences = ['偏好 "带引号" 和 {花括号}'];
        const argv = command.parse(Argv.parse(`u ${JSON.stringify(document)}`));
        expect(argv.args?.[1]).toBe(JSON.stringify(document));
        // Koishi's real parser preserves the greedy text argument verbatim;
        // execute the registered action against the real database.
        await command._actions[0]({ session: f.session, options: {} } as any, ...argv.args!);
        const structured = (await f.store.find(f.scope, f.ref))!.person;
        expect(structured.structuredProfile?.preferences).toEqual(document.preferences);
        expect(structured.profile).toContain(document.preferences[0]);
        const plain = f.app.$commander.get("people.edit")!;
        await plain._actions[0]({ session: f.session, options: {} } as any, "u", "legacy replacement");
        const legacy = (await f.store.find(f.scope, f.ref))!.person;
        expect(legacy.structuredProfile).toBeUndefined();
        expect(legacy.profile).toBe("legacy replacement");
    });
}

for (const change of ["profile", "off"]) {
    for (const action of ["read", "search"]) {
        test(`shared ${action} rejects ${change} changed during target discovery`, async (t) => {
            const f = await setup(t, true, "mind");
            const original = ContinuityStore.prototype.scenes;
            vi.spyOn(ContinuityStore.prototype, "scenes").mockImplementation(async function (scope) {
                const result = await original.call(this, scope);
                if (change === "off") await f.store.settings(f.scope, { mode: "off" }, "admin");
                else await f.store.setProfile(f.scope, f.ref, "corrected profile", "admin");
                return result;
            });
            const result = await f.tool.execute({ session: f.session, action, account_id: "u", query: "known" });
            expect(result.status).toBe("error");
        });
    }
}
