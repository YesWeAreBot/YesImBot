import { expect, it } from "vitest";

import { apply } from "../src/index";
import { PersonStore, accountRef, mindScope, sceneKey } from "../src/store";
import { fixture } from "./helpers";

async function accessSetup(t: Parameters<typeof fixture>[0]) {
    const tools = new Map<string, any>();
    const app = await fixture(t, (ctx) => {
        Object.defineProperty(ctx, "bots", {
            value: [
                {
                    platform: "onebot",
                    selfId: "bot",
                    session: (e: any) => ({ ...e, channelId: e.channel.id, isDirect: false, userId: e.user?.id || e.userId }),
                },
            ],
        });
        ctx.set("yesimbot", {
            world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: () => true },
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
            apply: (child: any) =>
                apply(child, {
                    enabled: true,
                    mode: "auto",
                    sharedMemory: true,
                    modelGroup: "",
                    summaryThreshold: 6,
                    cooldownSeconds: 600,
                    timeoutSeconds: 30,
                    maxQueue: 32,
                    recallScope: "current",
                }),
        });
    });
    const session: any = { platform: "onebot", selfId: "bot", bot: { selfId: "bot" }, channelId: "public", userId: "u", isDirect: false };
    const scope = mindScope(session),
        ref = accountRef("onebot", "u");
    const store = new PersonStore(app.database, "auto");
    const f = await store.recognize(scope, ref, "Person");
    return { tools, session, scope, ref, store, f };
}

it("review: shared read must not expose evidence provenance from a scene outside current recall scope", async (t) => {
    const { tools, session, scope, ref, store, f } = await accessSetup(t);
    await store.capture(scope, {
        id: "secret-source-id",
        userId: ref,
        name: "Person",
        text: "private observation",
        timestamp: Date.now(),
        provenance: {
            platform: "onebot",
            selfId: "bot",
            channelId: "secret-channel",
            messageId: "private-platform-id",
            scene: sceneKey({ ...session, channelId: "secret-channel" }),
            personId: f.person.id,
            accountRevision: f.account.bindingRevision ?? 0,
        },
    });
    await store.proposeClaims(
        scope,
        ref,
        [{ action: "support", category: "preferences", statement: "a global preference", messageIds: ["secret-source-id"] }],
        "model",
        { personId: f.person.id, personRevision: f.person.revision, accountRevision: f.account.revision },
    );
    const result = await tools.get("person_memory").execute({ session, action: "read", account_id: "u" });
    expect(result.status).toBe("success");
    expect(JSON.stringify(result.result)).not.toContain("secret-channel");
    expect(JSON.stringify(result.result)).not.toContain("private-platform-id");
    expect(JSON.stringify(result.result)).not.toContain("secret-source-id");
});

it("review: shared legacy propose receipt must not return hidden retained evidence snapshots", async (t) => {
    const { tools, session, scope, ref, store, f } = await accessSetup(t);
    await store.capture(scope, {
        id: "source:secret",
        userId: ref,
        name: "Person",
        text: "hidden private raw observation",
        timestamp: Date.now(),
        provenance: {
            platform: "onebot",
            selfId: "bot",
            channelId: "secret-channel",
            messageId: "private-message",
            scene: sceneKey({ ...session, channelId: "secret-channel" }),
            personId: f.person.id,
            accountRevision: f.account.bindingRevision ?? 0,
        },
    });
    await store.propose(scope, ref, "old profile", ["source:secret"], "model");
    const current = (await store.find(scope, ref))!;
    await store.capture(scope, {
        id: "source:public",
        userId: ref,
        name: "Person",
        text: "current public observation",
        timestamp: Date.now(),
        provenance: {
            platform: "onebot",
            selfId: "bot",
            channelId: "public",
            messageId: "public-message",
            scene: sceneKey(session),
            personId: current.person.id,
            accountRevision: current.accounts[0].bindingRevision ?? 0,
        },
    });
    const result = await tools.get("person_memory").execute({
        session,
        action: "propose",
        account_id: "u",
        profile: "new public profile",
        message_ids: ["source:public"],
        person_id: current.person.id,
        person_revision: current.person.revision,
        account_revision: current.accounts[0].revision,
    });
    expect(result.status).toBe("success");
    expect(JSON.stringify(result.result)).not.toContain("hidden private raw observation");
    expect(JSON.stringify(result.result)).not.toContain("secret-channel");
});
