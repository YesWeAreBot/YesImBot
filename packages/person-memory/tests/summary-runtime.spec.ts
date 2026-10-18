import assert from "node:assert/strict";

import pluginMock from "@koishijs/plugin-mock";
import { test } from "vitest";
const mock = (pluginMock as any).default ?? pluginMock;

import { getInstanceScope } from "../../core/src/shared/instance-scope";
import * as plugin from "../src/index";
import { PersonStore, accountRef, mindScope, sceneKey } from "../src/store";
import { SummaryQueue } from "../src/summary-queue";
import { fixtureContext } from "./helpers";

const defaults = { enabled: true, mode: "auto", modelGroup: "summary", summaryThreshold: 6, cooldownSeconds: 600, timeoutSeconds: 30, maxQueue: 32 };

for (const sharedMemory of [false, true])
    for (const revoked of [false, true]) {
        test(`plugin reload resumes stored summary output without another model call (shared=${sharedMemory}, revoked=${revoked})`, async (t) => {
            let calls = 0;
            let allowed = true;
            let fork;
            const app = await fixtureContext(t, (ctx) => {
                ctx.scope.key = "stable-core";
                ctx.plugin(mock);
                const service = {
                    tool: { capabilities: { trustedToolSession: 1 }, registerTool: () => () => {}, unregisterTool: () => {} },
                    prompt: { inject: () => () => {} },
                    world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: () => allowed },
                    model: {
                        useChatGroup: () => ({
                            chat: async () => {
                                calls++;
                                throw new Error("stored output must be reused");
                            },
                        }),
                    },
                };
                Object.defineProperty(service, "ctx", { value: ctx });
                ctx.set("yesimbot", service);
                fork = ctx.plugin(plugin, { ...defaults, sharedMemory });
                fork.key = "stable-person-memory";
            });
            await app.start();
            await app.database.prepared();
            const owner = fork.ctx;
            const domain = JSON.stringify([getInstanceScope(owner), getInstanceScope(owner, undefined, { owner })]);
            await fork.dispose();
            const store = new PersonStore(app.database, "auto");
            const scene = { platform: app.bots[0].platform, selfId: app.bots[0].selfId, channelId: "group", userId: "u" };
            const scope = sharedMemory ? mindScope(scene, "") : sceneKey(scene);
            const userId = sharedMemory ? accountRef(scene.platform, "u") : "u";
            await store.recognize(scope, userId, "群友");
            const identity = await store.find(scope, userId);
            const source = {
                id: "m",
                userId,
                name: "群友",
                text: "我喜欢 Python",
                timestamp: Date.now(),
                provenance: {
                    ...scene,
                    scene: sceneKey(scene),
                    messageId: "m",
                    personId: identity.person.id,
                    accountRevision: identity.accounts[0].bindingRevision ?? 0,
                },
            };
            await store.capture(scope, source);
            const found = await store.find(scope, userId);
            const queue = new SummaryQueue(app.database, domain);
            const job = await queue.enqueue(scope, userId);
            await queue.patch(job, {
                input: {
                    messages: [],
                    permissionEvidence: [source],
                    expected: { personId: found.person.id, personRevision: found.person.revision, accountRevision: found.accounts[0].bindingRevision ?? 0 },
                    evidenceIds: ["m"],
                    sourceCursor: ["m"],
                },
                output: { profile: "喜欢 Python", messageIds: ["m"] },
            });
            allowed = !revoked;
            fork = app.plugin(plugin, { ...defaults, sharedMemory });
            fork.key = "stable-person-memory";
            for (let i = 0; i < 100 && (await queue.list())[0]?.status === "pending"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal((await queue.list())[0].status, revoked ? "blocked" : "accepted");
            assert.equal((await store.find(scope, userId)).person.profile, revoked ? "" : "喜欢 Python");
            if (revoked) assert.deepEqual((await queue.list())[0].checkpoint, []);
            assert.equal(calls, 0);
            await fork.dispose();
        });
    }
