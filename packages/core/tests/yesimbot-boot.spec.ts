import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Context, Schema } from "koishi";
import type { Session } from "koishi";
import { expect, it } from "vitest";

import { Config } from "../src/config";
import { Extension, Tool } from "../src/extension/decorators";
import { Success } from "../src/extension/helpers";
import YesImBot from "../src/index";

// End-to-end boot smoke for the service refactor: the plugin must start every
// sub-service it owns and expose them through `ctx.yesimbot.<member>`.

@Extension({
    name: "boot-probe",
    display: "Boot Probe",
    description: "Regression probe for the yesimbot service wiring.",
    author: "test",
    version: "1.0.0",
})
class BootProbeExtension {
    constructor(
        public ctx: Context,
        public config: unknown = {},
    ) {}

    @Tool({
        name: "boot_probe",
        description: "returns a fixed token",
        parameters: Schema.object({}),
    })
    async probe() {
        return Success({ token: "probe-token" });
    }
}

// Only the session fields ToolService.invoke() reads on this path; a real Session is far larger.
const session = { platform: "onebot", channelId: "boot", userId: "user" } as unknown as Session;

async function boot() {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yib-boot-"));
    const notifications: unknown[] = [];
    const app = new Context({ baseDir });
    app.baseDir = baseDir;
    app.plugin(memory);
    // The console/notifier/server/http plugin stack is heavy for a smoke test; only
    // the members YesImBot and its sub-services touch are provided here.
    app.set("console", { addEntry() {} });
    app.set("notifier", {
        create: (message: unknown) => {
            notifications.push(message);
        },
    });
    app.set("server", { get() {} });
    app.set("http", {});
    app.plugin(
        YesImBot,
        Config({
            // Storage paths default to cwd-relative locations; keep the smoke test inside its temp dir.
            storagePath: path.join(baseDir, "assets"),
            image: { processedCachePath: path.join(baseDir, "assets", "processed") },
            coreMemoryPath: path.join(baseDir, "memory"),
        }),
    );
    app.plugin(BootProbeExtension);
    return {
        app,
        notifications,
        close: async () => {
            await app.stop();
            await rm(baseDir, { recursive: true, force: true });
        },
    };
}

it("boots every core sub-service and serves it through ctx.yesimbot", async () => {
    const f = await boot();
    try {
        await f.app.start();
        await f.app.database.prepared();

        const yib = f.app.yesimbot;
        await yib.ready;

        for (const name of ["logging", "asset", "prompt", "memory", "model", "world", "tool", "agent"] as const) {
            expect(yib[name], `ctx.yesimbot.${name}`).toBeTruthy();
        }
        expect(typeof yib.logging.getLogger).toBe("function");

        // No sub-service start() may throw: the plugin reports failures through the notifier.
        expect(f.notifications.filter((message) => String(message).includes("初始化时发生错误"))).toEqual([]);

        // ToolService.start() loaded the builtin extensions.
        expect(yib.tool.getToolSchemas().length).toBeGreaterThan(0);

        // The @Extension SDK registers through ctx.yesimbot.tool and invokes end-to-end.
        const probe = yib.tool.getTool("boot_probe");
        expect(probe?.description).toBe("returns a fixed token");
        const result = await yib.tool.invoke("boot_probe", {}, session);
        expect(result.status).toBe("success");
        expect(result.result).toEqual({ token: "probe-token" });

        // WorldStateService started: system events are persisted through its managers.
        await yib.world.recordSystemEvent({
            id: "boot-event",
            platform: "onebot",
            channelId: "boot",
            eventScope: "global",
            type: "boot",
            timestamp: new Date(),
            payload: {},
            message: "boot",
        });
        const events = await f.app.database.get("worldstate.system_events", {});
        expect(events.length).toBeGreaterThan(0);
    } finally {
        await f.close();
    }
});
