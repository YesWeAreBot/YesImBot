import assert from "node:assert/strict";

import pluginMock from "@koishijs/plugin-mock";
import { test } from "vitest";

import { summarySourceAllowed } from "../src/source-policy";
import { accountRef, mindScope, sceneKey, type Evidence } from "../src/store";
import { fixture } from "./helpers";

const mock = (pluginMock as any).default ?? pluginMock;
for (const shared of [false, true])
    for (const isDirect of [false, true])
        test(`summary source authorization reconstructs only the proven source kind (shared=${shared}, direct=${isDirect})`, async (t) => {
            const app = await fixture(t, (ctx) => ctx.plugin(mock));
            const bot = app.bots[0];
            const scene = { platform: bot.platform, selfId: bot.selfId, channelId: isDirect ? "u" : "g", userId: "u", isDirect };
            const scopeOf = shared ? (s) => mindScope(s, "domain") : sceneKey;
            const scope = scopeOf(scene);
            const evidence: Evidence = {
                id: "m",
                userId: shared ? accountRef(bot.platform, "u") : "u",
                name: "群友",
                text: "内容",
                timestamp: Date.now(),
                provenance: {
                    ...scene,
                    guildId: "guild",
                    scene: sceneKey(scene),
                    messageId: "m",
                    personId: "p",
                    accountRevision: 1,
                },
            };
            const allowed = (s) => s.isDirect === isDirect && s.channelId === scene.channelId && s.userId === "u";
            assert.equal(summarySourceAllowed(app, evidence, scope, shared, allowed, scopeOf), true);
            assert.equal(
                summarySourceAllowed(app, evidence, scope, shared, (s) => allowed(s) && s.guildId === "guild", scopeOf),
                true,
            );
            assert.equal(
                summarySourceAllowed(app, evidence, scope, shared, (s) => allowed(s) && s.guildId === "other", scopeOf),
                false,
            );
            assert.equal(
                summarySourceAllowed(app, evidence, scope, shared, () => false, scopeOf),
                false,
            );
            assert.equal(summarySourceAllowed(app, evidence, "other-scope", shared, allowed, scopeOf), false);
            assert.equal(
                summarySourceAllowed(app, { ...evidence, provenance: { ...evidence.provenance!, scene: undefined } }, scope, shared, allowed, scopeOf),
                false,
            );
            assert.equal(
                summarySourceAllowed(app, { ...evidence, provenance: { ...evidence.provenance!, selfId: "missing-bot" } }, scope, shared, allowed, scopeOf),
                false,
            );
        });
