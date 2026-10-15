// Uses the real core service prototypes and Koishi plugin lifecycle;
// models, adapters and the remainder of the full core are intentionally absent.
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";

import { test } from "vitest";

import { ToolService } from "../../core/src/extension/service";
import { WorldStateService } from "../../core/src/world/service";
import * as plugin from "../src/index";
import { PersonStore, sceneKey } from "../src/store";
import { fixture } from "./helpers";

const defaults = { enabled: true, mode: "review", modelGroup: "", summaryThreshold: 6, cooldownSeconds: 600, timeoutSeconds: 30, maxQueue: 32 };
for (const version of ["legacy", "current"]) {
    test(`real Koishi loads person-memory against ${version} core service capabilities`, async (t) => {
        const tools = new Map(),
            errors = [],
            effects = [];
        const world = Object.create(WorldStateService.prototype);
        world.isChannelAllowed = () => true;
        const tool = Object.create(ToolService.prototype);
        tool.registerTool = (entry) => {
            effects.push("tool");
            tools.set(entry.name, entry);
        };
        tool.unregisterTool = (name) => tools.delete(name);
        if (version === "legacy") {
            // Legacy core services expose no capability contract at all.
            Object.defineProperty(world, "capabilities", { value: undefined });
            Object.defineProperty(tool, "capabilities", { value: undefined });
        }
        const app = await fixture(t, () => {});
        app.on("internal/error", (error) => errors.push(error));
        app.set("yesimbot", {
            tool,
            world,
            prompt: {
                inject: () => {
                    effects.push("prompt");
                    return () => {};
                },
            },
        });
        const fork = app.plugin(plugin, defaults);
        await tick();
        if (version === "legacy") {
            assert.equal(world.capabilities, undefined);
            assert.equal(tool.capabilities, undefined);
            assert.match(String(errors[0]), /3\.0\.4.*beforeUserStimulus.*trustedToolSession/);
            assert.deepEqual(effects, []);
            assert.equal(app.model.tables["person_memory.state"], undefined);
            assert.equal(app.$commander.get("people.status"), undefined);
        } else {
            assert.equal(world.capabilities.beforeUserStimulus, 1);
            assert.equal(tool.capabilities.trustedToolSession, 1);
            assert.deepEqual(errors, []);
            await app.database.prepared();
            const s = {
                platform: "onebot",
                selfId: "b",
                bot: { selfId: "b" },
                channelId: "g",
                userId: "u",
                messageId: "m",
                timestamp: 1,
                content: "hello",
                author: { name: "U" },
            };
            await app.parallel("yesimbot/before-user-stimulus", s);
            const store = new PersonStore(app.database, "off");
            assert.ok(await store.find(sceneKey(s), "u"));
            assert.equal((await store.sources(sceneKey(s), "u"))[0].text, "hello");
            assert.ok(tools.has("person_memory"));
            assert.ok(app.$commander.get("people.status"));
        }
        fork.dispose();
    });
}
