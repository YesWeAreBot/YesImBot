import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Context, Service } from "koishi";
import { expect, it } from "vitest";

import YesImBot from "../src";

it("keeps persisted history and decisions after a loader-key assignment and real config reload", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yesimbot-scope-reload-"));
    const ctx = new Context();
    ctx.baseDir = directory;
    const errors: unknown[] = [];
    class Console extends Service {
        constructor(scope: Context) {
            super(scope, "console", true);
        }
        addEntry() {
            return () => {};
        }
    }
    class Notifier extends Service {
        constructor(scope: Context) {
            super(scope, "notifier", true);
        }
        create(value: unknown) {
            errors.push(value);
            return { update() {}, dispose() {} };
        }
    }
    try {
        ctx.plugin(Console);
        ctx.plugin(Notifier);
        ctx.set("http", {} as any);
        ctx.set("server", {} as any);
        ctx.plugin(memory);
        await ctx.start();
        await ctx.database.prepared();
        const group = ctx.plugin({ name: "scope-reload-group", reusable: true, apply() {} });
        (group as any).key = "group:stable";
        const parent = group.ctx;
        const config = YesImBot.Config({
            version: "2.0.1",
            providers: [
                {
                    name: "local",
                    type: "OpenAI",
                    baseURL: "http://127.0.0.1:9/v1",
                    apiKey: "unused",
                    models: [{ modelId: "local", abilities: ["对话", "嵌入"] }],
                },
            ],
            modelGroups: [{ name: "local", models: [{ providerName: "local", modelId: "local" }] }],
            task: { chat: "local", embed: "local" },
            storagePath: path.join(directory, "assets"),
            image: { processedCachePath: path.join(directory, "cache") },
            decisionRecording: { enabled: true },
            l2_memory: { enabled: false },
            l3_memory: { enabled: false },
        });
        const fork = parent.plugin(YesImBot, config);
        // Koishi Loader attaches the entry key after plugin() returns.
        (fork as any).key = "yesimbot:stable";
        await ctx.start();
        const before = parent.get("yesimbot");
        await before.ready;
        const target = { platform: "local", selfId: "bot", channelId: "room", isDirect: false };
        await before.world.l1_manager.recordHeartbeat("persisted-turn", "local", "room", 1, 2);
        (before.agent as any).decisions.begin(target, "user_message");
        const firstDecisions = await (before.agent as any).decisionJournal.list();
        expect(firstDecisions).toHaveLength(1);
        const beforePaths = [(before.world.l1_manager as any).basePath, (before.agent as any).decisionJournal.filePath];

        fork.update(config, true);
        await expect.poll(() => parent.get("yesimbot") !== before).toBe(true);
        const after = parent.get("yesimbot");
        await after.ready;
        const afterPaths = [(after.world.l1_manager as any).basePath, (after.agent as any).decisionJournal.filePath];
        expect(afterPaths).toEqual(beforePaths);
        expect((await after.world.l1_manager.getL1History("local", "room", 10)).map((row: any) => row.turnId)).toEqual(["persisted-turn"]);
        expect((await (after.agent as any).decisionJournal.list()).map((row: any) => row.id)).toEqual(firstDecisions.map((row: any) => row.id));
        expect(errors).toEqual([]);
    } finally {
        await ctx.stop();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
