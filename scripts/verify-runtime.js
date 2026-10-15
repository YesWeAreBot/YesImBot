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
const plugin = repoRequire(process.env.YESIMBOT_SMOKE_ROOT ? "koishi-plugin-yesimbot" : "./packages/core/lib/index.js");
const services = repoRequire(process.env.YESIMBOT_SMOKE_ROOT ? "koishi-plugin-yesimbot/services" : "./packages/core/lib/services/index.js");
const shared = repoRequire(process.env.YESIMBOT_SMOKE_ROOT ? "koishi-plugin-yesimbot/shared" : "./packages/core/lib/shared/index.js");
assert.strictEqual(plugin.withUsageScope, services.withUsageScope, "Public roots must share model usage scopes");
assert.strictEqual(plugin.withReplyTurn, shared.withReplyTurn, "Public roots must share reply scopes");
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
        const names = [
            "yesimbot.logger",
            "yesimbot.asset",
            "yesimbot.prompt",
            "yesimbot.tool",
            "yesimbot.model",
            "yesimbot.memory",
            "yesimbot.world-state",
            "yesimbot.agent",
        ];
        while (!names.every((name) => ctx[name] && ctx[name].ctx.scope.isActive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
        for (const name of names) assert.ok(ctx[name]?.ctx.scope.isActive, name + " failed to become active");
        await new Promise((r) => setTimeout(r, 1250));
        assert.deepEqual(errors, []);
        console.log("Built core booted with actual Koishi and in-memory database");
        const agent = ctx["yesimbot.agent"];
        const tools = ctx["yesimbot.tool"];
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
        assert.equal(cancelled, "cancelled", "Built root and services must share the active cancellation context");
        console.log("Built entry-point cancellation boundary verified");
    } finally {
        await ctx.stop();
        await fs.rm(directory, { recursive: true, force: true });
    }
    console.log("Built core unloaded");
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
