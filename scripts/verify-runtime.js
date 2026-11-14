import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const runtimeRoot = process.env.YESIMBOT_SMOKE_ROOT || process.cwd();
const require = createRequire(pathToFileURL(path.join(runtimeRoot, "package.json")));
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const repoRequire = require;
const { Context, Service, Logger } = repoRequire("koishi");
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
for (const name of ["registerHistoryResetParticipant", "prepareHistoryReset"]) {
    assert.equal(typeof plugin[name], "function", `Root must export ${name}`);
    assert.strictEqual(plugin[name], imported[name], `ESM and CJS roots must share ${name}`);
}
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
async function verifyHistoryResetRuntime(sharedMemory) {
    const { default: Loader } = repoRequire("@koishijs/loader");
    const person = repoRequire("koishi-plugin-yesimbot-extension-person-memory");
    const mock = repoRequire("@koishijs/plugin-mock");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yib-installed-reset-"));
    let app;
    try {
        const filename = path.join(directory, "koishi.json");
        await fs.writeFile(
            filename,
            JSON.stringify({
                plugins: {
                    "console:runtime": {},
                    "notifier:runtime": {},
                    "server:runtime": {},
                    "http:runtime": {},
                    "database-memory:runtime": {},
                    "mock:runtime": {},
                    "yesimbot:runtime": {
                        version: "2.0.1",
                        coreMemoryPath: path.join(directory, "memory"),
                        storagePath: path.join(directory, "assets"),
                        image: { processedCachePath: path.join(directory, "cache") },
                        allowedChannels: [{ platform: "mock", type: "guild", id: "reset-room" }],
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
                        decisionRecording: { enabled: false },
                        l2_memory: { enabled: false },
                        l3_memory: { enabled: false },
                    },
                    "person-memory:runtime": { enabled: true, mode: "review", sharedMemory, memoryDomain: "packaged-smoke", modelGroup: "" },
                },
            }),
        );
        const loader = new Loader();
        // NodeLoader normally lives inside the CLI daemon. This standalone smoke
        // test also stops its root app, disposing the logger service before all
        // loader unload callbacks. Keep a real Logger alive through that teardown.
        const loaderLogger = new Logger("loader");
        loader.logUpdate = (type, _parent, key) => loaderLogger.info("%s plugin %c", type, key);
        await loader.init(filename);
        const modules = {
            console: Console,
            notifier: Notifier,
            server: Server,
            http: Http,
            "database-memory": memory,
            mock,
            yesimbot: plugin,
            "person-memory": person,
        };
        const originalImport = loader.import.bind(loader);
        loader.import = (name) => (name in modules ? Promise.resolve(modules[name]) : originalImport(name));
        // This test owns the temporary loader lifecycle; unloading must not ask a
        // CLI daemon to restart the package-verification process.
        loader.fullReload = () => {};
        await loader.readConfig();
        app = await loader.createApp();
        await app.start();
        await app.database.prepared();
        assert.ok(app.yesimbot, "Real loader did not construct the core");
        await app.yesimbot.ready;
        assert.ok(app.yesimbot.isReady, "Real loader core was not ready");
        assert.ok(app.$commander.get("people.create"), "Real person plugin did not register its command");
        const owner = Object.getOwnPropertyDescriptor(app.yesimbot, "ctx").value;
        for (const [register, prepare] of [
            [imported.registerHistoryResetParticipant, plugin.prepareHistoryReset],
            [plugin.registerHistoryResetParticipant, imported.prepareHistoryReset],
        ]) {
            let fenced = 0,
                released = 0;
            const unregister = register(owner.extend(), {
                prepare() {
                    fenced++;
                    return {
                        release() {
                            released++;
                        },
                    };
                },
            });
            try {
                const reset = prepare(owner, { type: "all" });
                assert.equal(fenced, 1, "Cross-format reset must fence the same registry synchronously");
                await reset.ready;
                await reset.finish();
                await reset.finish();
                assert.equal(released, 1, "Cross-format reset release must be idempotent");
            } finally {
                unregister();
            }
        }
        await app.mock.initUser("reset-admin", 3);
        await app.mock.initChannel("reset-room");
        const client = app.mock.client("reset-admin", "reset-room");
        const marker = `packaged-${sharedMemory ? "shared" : "scene"}-person`;
        const created = (await client.receive(`people.create ${marker}`)).join("\n");
        assert.ok(created.includes(marker), "Real person command failed before reset");
        const containsMarker = (rows) => rows.some((row) => Object.values(row.state?.people ?? {}).some((person) => person.name === marker));
        assert.ok(containsMarker(await app.database.get("person_memory.state", {})), "Person fixture must be persisted before clear");
        const cleared = (await client.receive("history.clear -a all")).join("\n");
        assert.match(cleared, /清除|清理/, "Real history clear command did not return a receipt");
        assert.equal(
            containsMarker(await app.database.get("person_memory.state", {})),
            false,
            "Packaged core history.clear must purge the owning real person plugin state",
        );
        assert.deepEqual(errors, [], "Real core/person loader emitted an initialization error");
        console.log(`Built core/person reset verified through real loader (${sharedMemory ? "shared" : "scene"})`);
    } finally {
        await app?.stop();
        await fs.rm(directory, { recursive: true, force: true });
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
            coreMemoryPath: path.join(directory, "memory"),
            storagePath: path.join(directory, "assets"),
            image: { processedCachePath: path.join(directory, "cache") },
            decisionRecording: { enabled: false },
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
    await verifyHistoryResetRuntime(false);
    await verifyHistoryResetRuntime(true);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
