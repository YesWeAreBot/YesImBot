import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Context, Service } from "koishi";
import { expect, it, vi } from "vitest";

import YesImBot, { AssetService, getInstanceScope } from "../../core/src";
import * as reminders from "../src";
import { registerModels, TaskStore, taskOwner } from "../src/store";

it("does not recover or consume reminders when real core startup fails despite ready fulfilling", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yesimbot-failed-core-"));
    const ctx = new Context();
    ctx.baseDir = directory;
    const notifications: unknown[] = [];
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
            notifications.push(value);
            return { update() {}, dispose() {} };
        }
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const start = vi.spyOn(AssetService.prototype, "start").mockImplementation(async () => {
        await gate;
        throw new Error("asset startup failed");
    });
    try {
        ctx.plugin(Console);
        ctx.plugin(Notifier);
        ctx.set("http", {} as any);
        ctx.set("server", {} as any);
        ctx.plugin(memory);
        registerModels(ctx);
        await ctx.start();
        await ctx.database.prepared();
        const coreFork = ctx.plugin(
            YesImBot,
            YesImBot.Config({
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
                l2_memory: { enabled: false },
                l3_memory: { enabled: false },
            }),
        );
        (coreFork as any).key = "yesimbot:failed-start";
        const core = ctx.get("yesimbot");
        const reminderFork = ctx.plugin(reminders, { enabled: true, pollIntervalSeconds: 60 });
        (reminderFork as any).key = "durable-tasks:stable";
        const store = new TaskStore(
            ctx.database,
            taskOwner(getInstanceScope(reminderFork.ctx), getInstanceScope(reminderFork.ctx, undefined, { owner: reminderFork.ctx })),
        );
        const input = {
            platform: "local",
            selfId: "bot",
            channelId: "room",
            requester: "user",
            guildId: "guild",
            isDirect: false,
            deadline: 1,
            content: "keep queued",
            idempotencyKey: "queued",
        };
        const queued = await store.enqueue(input, 0);
        const running = await store.enqueue({ ...input, idempotencyKey: "running" }, 0);
        await store.claim(running.id);
        release();
        await expect(core.ready).resolves.toBeUndefined();
        await ctx.lifecycle.flush();
        expect(notifications).toContain("初始化时发生错误");
        expect((await store.get(running.id))?.status).toBe("running");
        expect((await store.get(queued.id))?.status).toBe("queued");
        expect(core.isReady).toBe(false);
    } finally {
        release();
        await ctx.stop();
        start.mockRestore();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
