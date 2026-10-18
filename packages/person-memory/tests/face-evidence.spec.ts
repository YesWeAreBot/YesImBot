import { h } from "koishi";
import { OneBot } from "koishi-plugin-adapter-onebot";
import { expect, it } from "vitest";

import * as plugin from "../src/index";
import { PersonStore, accountRef, mindScope, sceneKey } from "../src/store";
import { fixture } from "./helpers";

for (const sharedMemory of [false, true]) {
    it(`captures face labels as typed evidence without changing the session (shared=${sharedMemory})`, async (t) => {
        const app = await fixture(t, (ctx) => {
            ctx.set("yesimbot", {
                world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: () => true },
                tool: { capabilities: { trustedToolSession: 1 }, registerTool: () => () => {}, unregisterTool() {} },
                prompt: { inject: () => () => {} },
            });
            ctx.plugin(plugin, {
                enabled: true,
                mode: "review",
                modelGroup: "",
                sharedMemory,
                summaryThreshold: 6,
                cooldownSeconds: 600,
                timeoutSeconds: 30,
                maxQueue: 32,
            });
        });
        const bot = { platform: "onebot", selfId: "bot", config: { advanced: {} } };
        const raw = {
            message_id: 1,
            sender: { user_id: 7, nickname: "User" },
            time: 1792284169,
            message: [{ type: "face", data: { id: "99999", raw: { faceText: "/冤种", faceType: 3 } } }],
        };
        const decoded = await OneBot.adaptMessage(bot as any, raw as any);
        const session: any = {
            platform: "onebot",
            selfId: "bot",
            bot,
            channelId: "room",
            userId: "7",
            messageId: "1",
            timestamp: Date.now(),
            author: { name: "User" },
            content: decoded.content,
            onebot: raw,
        };
        await app.parallel("yesimbot/before-user-stimulus", session);
        const scope = sharedMemory ? mindScope(session) : sceneKey(session);
        const ref = sharedMemory ? accountRef("onebot", "7") : "7";
        const evidence = (await new PersonStore(app.database, "review").sources(scope, ref))[0];
        expect(h.parse(evidence.text)[0].attrs).toMatchObject({ id: "99999", name: "冤种", kind: "super" });
        expect(session.content).toBe(decoded.content);
    });
}
