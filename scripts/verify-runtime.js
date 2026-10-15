import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const runtimeRoot = process.env.YESIMBOT_SMOKE_ROOT || process.cwd();
const require = createRequire(pathToFileURL(path.join(runtimeRoot, "package.json")));
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const repoRequire = require;
const { Context, Service } = repoRequire("koishi");
const plugin = repoRequire("koishi-plugin-yesimbot");
const packageFile = repoRequire.resolve("koishi-plugin-yesimbot/package.json");
const manifest = repoRequire(packageFile);
// Resolve the import branch from the same installed package as createRequire,
// including when this script is run against packed artifacts outside the repo.
const importEntry = path.resolve(path.dirname(packageFile), manifest.exports["."].import);
const imported = await import(pathToFileURL(importEntry).href);
assert.strictEqual(plugin.default, imported.default, "ESM and CJS roots must share the plugin constructor");
assert.equal(typeof plugin.withUsageScope, "function", "Root must export model usage scopes");
assert.equal(typeof plugin.withReplyTurn, "function", "Root must export reply scopes");
assert.strictEqual(plugin.withUsageScope, imported.withUsageScope, "ESM and CJS roots must share model usage scopes");
assert.strictEqual(plugin.withReplyTurn, imported.withReplyTurn, "ESM and CJS roots must share reply scopes");
const memory = repoRequire("@koishijs/plugin-database-memory");
const errors = [];
class Console extends Service {
    constructor(ctx) {
        super(ctx, "console", true);
    }
    addEntry() {
        return () => {};
    }
}
class Notifier extends Service {
    constructor(ctx) {
        super(ctx, "notifier", true);
    }
    create(value) {
        errors.push(value);
        return { update() {}, dispose() {} };
    }
}
class Http extends Service {
    constructor(ctx) {
        super(ctx, "http", true);
    }
}
class Server extends Service {
    constructor(ctx) {
        super(ctx, "server", true);
    }
}
(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yib-installed-boot-"));
    const ctx = new Context();
    ctx.baseDir = directory;
    try {
        ctx.plugin(Console);
        ctx.plugin(Notifier);
        ctx.plugin(Http);
        ctx.plugin(Server);
        ctx.plugin(memory.default ?? memory);
        const config = plugin.default.Config({
            providers: [
                {
                    name: "smoke",
                    type: "OpenAI",
                    baseURL: "http://127.0.0.1:9/v1",
                    apiKey: "unused",
                    models: [{ modelId: "smoke", abilities: ["对话", "嵌入"] }],
                },
            ],
            modelGroups: [{ name: "smoke", models: [{ providerName: "smoke", modelId: "smoke" }] }],
            task: { chat: "smoke", embed: "smoke" },
            storagePath: path.join(directory, "assets"),
            image: { processedCachePath: path.join(directory, "cache") },
            behavior: { decisionRecording: { enabled: false } },
            l2_memory: { enabled: false },
            l3_memory: { enabled: false },
        });
        ctx.plugin(plugin.default, config);
        await ctx.start();
        const deadline = Date.now() + 12500;
        while (!ctx.yesimbot && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
        assert.ok(ctx.yesimbot?.ctx.scope.isActive, "yesimbot failed to become active");
        await Promise.race([ctx.yesimbot.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("yesimbot startup timed out")), 12500).unref())]);
        for (const name of ["logging", "asset", "prompt", "tool", "model", "memory", "world", "agent"]) {
            assert.ok(ctx.yesimbot[name], `yesimbot.${name} was not constructed`);
        }
        await new Promise((r) => setTimeout(r, 1250));
        assert.deepEqual(errors, []);
        console.log("Built core booted with actual Koishi and in-memory database");
        const agent = ctx.yesimbot.agent;
        const tools = ctx.yesimbot.tool;
        let ready, release;
        const entered = new Promise((r) => (ready = r)),
            blocked = new Promise((r) => (release = r));
        tools.registerTool({
            name: "artifact_cancel_probe",
            parameters: repoRequire("koishi").Schema.object({}),
            execute: async () => {
                ready();
                await blocked;
                return { status: "success" };
            },
        });
        agent.processor.runCycle = ({ session }) => tools.invoke("artifact_cancel_probe", {}, session);
        const processing = agent.scheduler.taskCallback({
            type: "scheduled_task",
            session: { platform: "smoke", selfId: "bot", channelId: "room", cid: "smoke:room", isDirect: false, userId: "u", bot: {} },
            channelCid: "smoke:room",
            priority: 1,
            payload: {},
        });
        const outcome = processing.then(
            () => "completed",
            () => "cancelled",
        );
        await entered;
        for (const controller of agent.activeTurns.values()) controller.abort();
        const cancelled = await Promise.race([outcome, new Promise((r) => setTimeout(() => r("blocked"), 50))]);
        release();
        await outcome;
        assert.equal(cancelled, "cancelled", "Built root exports must share the active cancellation context");
        console.log("Built entry-point cancellation boundary verified");
    } finally {
        await ctx.stop();
        await fs.rm(directory, { recursive: true, force: true });
    }
    console.log("Built core unloaded");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
