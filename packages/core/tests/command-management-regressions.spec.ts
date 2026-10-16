import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Bot, Context, Schema } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as ConfigCommands from "../src/commands/config";
import { Config } from "../src/config";
import QManagerExtension from "../src/extension/builtin/qmanager";
import { Extension, Tool } from "../src/extension/decorators";
import { ToolService } from "../src/extension/service";
import type { IExtension, ToolDefinition } from "../src/extension/types";
import YesImBot from "../src/index";
import { loggingStub } from "./helpers/yesimbot";

const apps: Context[] = [];
afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop();
});
function app() {
    const ctx = new Context();
    apps.push(ctx);
    return ctx;
}
function session(ctx: Context) {
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, { ctx, context: ctx, config: {}, platform: "test", user: { id: "bot" }, callbacks: {} });
    const result = bot.session({ type: "message", channel: { id: "group" }, user: { id: "admin" } });
    result.user = { authority: 3 };
    result.text = (key: string) => key;
    return result;
}
async function run(ctx: Context, name: string, input = "") {
    const command = ctx.$commander.get(name)!;
    const argv = command.parse(input);
    argv.session = session(ctx);
    return command.execute(argv);
}
function service(ctx: Context, config = Config({})) {
    return new ToolService(ctx, config, { logging: loggingStub(), prompt: {} as any, world: {} as any });
}
function extension(ctx: Context, name: string, tools: ToolDefinition[], builtin = false): IExtension {
    return { ctx, config: {}, metadata: { name, version: "1", description: name, builtin }, tools: new Map(tools.map((tool) => [tool.name, tool])) };
}
function tool(name: string, parameters = Schema.object({})): ToolDefinition {
    return { name, description: name, parameters, execute: vi.fn<() => Promise<any>>(async () => ({ status: "success", result: "ok" })) };
}

describe("configuration commands", () => {
    it("applies conf.set to the running parent plugin without requiring force", async () => {
        const ctx = app();
        let live: Config;
        let starts = 0;
        function Parent(c: Context, config: Config) {
            starts++;
            live = config;
            c.plugin(ConfigCommands, config);
        }
        ctx.plugin(Parent, Config({ heartbeat: 5 }));
        await ctx.start();
        expect(await run(ctx, "conf.set", "heartbeat 7")).toBe("设置成功");
        expect(live!.heartbeat).toBe(7);
        expect(starts).toBe(2);
        expect(await run(ctx, "conf.get", "heartbeat")).toBe("7");
    });
    it("returns not found for missing intermediate fields and array entries", async () => {
        const ctx = app();
        ctx.plugin(ConfigCommands, Config({ providers: [] }));
        const errors: unknown[] = [];
        ctx.on("command-error", (_argv, error) => {
            errors.push(error);
        });
        await ctx.start();
        for (const key of ["missing.leaf", "providers[999].apiKey", "missing"]) {
            expect(await run(ctx, "conf.get", key)).toBe("未找到配置");
        }
        expect(errors).toEqual([]);
        expect(await run(ctx, "conf.get")).toBe("请输入有效的配置键");
    });
});

describe("extension management", () => {
    it("preserves the complete core config and builtin options while disable/enable reload the actual plugin", async () => {
        const ctx = app();
        let live: ToolService;
        let current: Config;
        let starts = 0;
        const persisted: any[] = [];
        ctx.on("internal/before-update", (_scope, config) => {
            persisted.push(config);
        });
        function Parent(c: Context, config: Config) {
            starts++;
            current = config;
            live = service(c, config);
            live.register(extension(c, "qmanager", [tool("ban")], true), config.extra?.qmanager?.enabled !== false, config.extra?.qmanager);
            (live as any).registerCommands();
        }
        const initial = Config({
            heartbeat: 7,
            providers: [{ name: "p", models: [{ modelId: "m", abilities: [] }], apiKey: "secret" }],
            extra: { qmanager: { enabled: true, custom: 42 }, search: { enabled: false } },
        });
        ctx.plugin(Parent, initial);
        await ctx.start();
        expect(live!.getTool("ban")).toBeTruthy();
        expect(await run(ctx, "extension.disable", "qmanager")).toBe("禁用成功");
        expect(current!.heartbeat).toBe(7);
        expect(current!.providers).toEqual(initial.providers);
        expect(current!.extra?.qmanager).toEqual({ enabled: false, custom: 42 });
        expect(current!.extra?.search).toEqual({ enabled: false });
        expect(persisted.at(-1)).toEqual(current!);
        expect(live!.getTool("ban")).toBeUndefined();
        expect(starts).toBe(2);
        expect(await run(ctx, "extension.enable", "qmanager")).toBe("启用成功");
        expect(current!.extra?.qmanager).toEqual({ enabled: true, custom: 42 });
        expect(live!.getTool("ban")).toBeTruthy();
        expect(starts).toBe(3);
    });
    it("toggles external extensions through their own plugin configuration", async () => {
        const ctx = app();
        const manager = service(ctx, Config({ heartbeat: 7 }));
        (manager as any).registerCommands();
        let externalConfig: any;
        let starts = 0;
        function External(c: Context, config: any) {
            starts++;
            externalConfig = config;
            const ext = extension(c, "external", [tool("external_tool")]);
            manager.register(ext, config.enabled !== false, config);
            c.on("dispose", () => {
                manager.unregister("external", ext);
            });
        }
        ctx.plugin(External, { enabled: true, custom: "keep" });
        await ctx.start();
        expect(await run(ctx, "extension.disable", "external")).toBe("禁用成功");
        expect(externalConfig).toEqual({ enabled: false, custom: "keep" });
        expect(manager.getTool("external_tool")).toBeUndefined();
        expect(await run(ctx, "extension.enable", "external")).toBe("启用成功");
        expect(externalConfig).toEqual({ enabled: true, custom: "keep" });
        expect(manager.getTool("external_tool")).toBeTruthy();
        expect(starts).toBe(3);
        expect(manager.config.heartbeat).toBe(7);
    });
    it("keeps replacement tools when unloading their former owner", () => {
        const ctx = app(),
            manager = service(ctx);
        const oldTool = tool("shared"),
            newTool = tool("shared");
        manager.register(extension(ctx, "old", [oldTool]), true, {});
        manager.register(extension(ctx, "new", [newTool]), true, {});
        expect(manager.unregister("old")).toBe(true);
        expect(manager.getTool("shared")).toBe(newTool);
    });
    it("ignores stale disposal of a replaced extension with the same name", () => {
        const ctx = app(),
            manager = service(ctx);
        const old = extension(ctx, "same", [tool("old")]);
        const replacement = extension(ctx, "same", [tool("new")]);
        manager.register(old, true, {});
        manager.register(replacement, true, {});
        manager.unregister("same", old);
        expect(manager.getExtension("same") === replacement).toBe(true);
        expect(manager.getTool("new")).toBe(replacement.tools.get("new"));
        expect(manager.getTool("old")).toBeUndefined();
    });
});

async function invocationFixture(parameters: Schema) {
    const ctx = app(),
        manager = service(ctx),
        probe = tool("probe", parameters);
    manager.registerTool(probe);
    (manager as any).registerCommands();
    await ctx.start();
    return { ctx, probe };
}
describe("typed tool invocation", () => {
    it("uses the real schema for primitive types while keeping long numeric IDs as strings", async () => {
        const { ctx, probe } = await invocationFixture(
            Schema.object({
                id: Schema.string().required(),
                count: Schema.natural().required(),
                enabled: Schema.boolean().required(),
                mode: Schema.union([Schema.const("fast"), Schema.const(2)]).required(),
            }),
        );
        expect(String(await run(ctx, "tool.invoke", "probe id=900719925474099312345 count=7 enabled=false mode=2"))).toContain("调用成功");
        expect(probe.execute).toHaveBeenCalledWith(expect.objectContaining({ id: "900719925474099312345", count: 7, enabled: false, mode: 2 }));
    });
    it.each([
        'payload={"items": [{"label": "a b", "count": 2}], "ok": true} label="hello world"',
        `payload='{"items": [{"label": "a b", "count": 2}], "ok": true}' label='hello world'`,
    ])("accepts nested JSON and quoted strings: %s", async (input) => {
        const { ctx, probe } = await invocationFixture(
            Schema.object({ payload: Schema.object({ items: Schema.array(Schema.object({ label: String, count: Number })), ok: Boolean }), label: String }),
        );
        expect(String(await run(ctx, "tool.invoke", `probe ${input}`))).toContain("调用成功");
        expect(probe.execute).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { items: [{ label: "a b", count: 2 }], ok: true }, label: "hello world" }),
        );
    });
    it("keeps schema validation failures and unknown tools friendly", async () => {
        const { ctx, probe } = await invocationFixture(Schema.object({ count: Schema.natural().required() }));
        expect(String(await run(ctx, "tool.invoke", "probe count=-1"))).toContain("调用失败");
        expect(probe.execute).not.toHaveBeenCalled();
        expect(String(await run(ctx, "tool.invoke", "not_found count=1"))).toContain("未找到");
    });
});

function moderationFixture(overrides = {}) {
    const extension = Object.create(QManagerExtension.prototype) as QManagerExtension;
    extension.ctx = { logger: { info() {}, error() {} } } as any;
    const bot = {
        muteGuildMember: vi.fn<(...args: any[]) => Promise<void>>(async () => {}),
        kickGuildMember: vi.fn<(...args: any[]) => Promise<void>>(async () => {}),
    };
    return { extension, bot, session: { channelId: "text-channel", guildId: "server", selfId: "bot", bot, ...overrides } as any };
}
describe("guild moderation targets", () => {
    it("defaults guild moderation to the current guild", async () => {
        const f = moderationFixture();
        await f.extension.ban({ session: f.session, user_id: "alice", duration: 1 } as any);
        await f.extension.kick({ session: f.session, user_id: "alice" } as any);
        expect(f.bot.muteGuildMember).toHaveBeenCalledWith("server", "alice", 60000);
        expect(f.bot.kickGuildMember).toHaveBeenCalledWith("server", "alice");
    });
    it("rejects default guild moderation in a private session", async () => {
        const f = moderationFixture({ guildId: undefined, isDirect: true });
        expect((await f.extension.kick({ session: f.session, user_id: "alice" } as any)).status).toBe("error");
        expect(f.bot.kickGuildMember).not.toHaveBeenCalled();
    });
    it("retains explicit guild targeting", async () => {
        const f = moderationFixture();
        await f.extension.kick({ session: f.session, user_id: "alice", channel_id: "other-server" } as any);
        expect(f.bot.kickGuildMember).toHaveBeenCalledWith("other-server", "alice");
    });
});

it("reloads real YesImBot builtin extensions while preserving the actual service-scope config", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yib-command-config-"));
    const ctx = new Context({ baseDir });
    ctx.baseDir = baseDir;
    ctx.plugin(memory);
    ctx.set("console", { addEntry() {} });
    ctx.set("notifier", { create() {} });
    ctx.set("server", { get() {} });
    ctx.set("http", {});
    ctx.plugin(
        YesImBot,
        Config({
            heartbeat: 7,
            storagePath: path.join(baseDir, "assets"),
            image: { processedCachePath: path.join(baseDir, "processed") },
            coreMemoryPath: path.join(baseDir, "memory"),
        }),
    );
    try {
        await ctx.start();
        await ctx.yesimbot.ready;
        const original = ctx.yesimbot;
        expect(original.tool.getTool("ban")).toBeTruthy();
        const saved: any[] = [];
        ctx.on("internal/before-update", (_scope, config) => {
            saved.push(config);
        });
        expect(await run(ctx, "extension.disable", "qmanager")).toBe("禁用成功");
        await ctx.yesimbot.ready;
        await ctx.lifecycle.flush();
        expect(ctx.yesimbot === original).toBe(false);
        expect(ctx.yesimbot.config.heartbeat).toBe(7);
        expect(ctx.yesimbot.config.storagePath).toBe(path.join(baseDir, "assets"));
        expect(ctx.yesimbot.config.extra?.qmanager?.enabled).toBe(false);
        expect(saved.some((config) => config.extra?.qmanager?.enabled === false && config.heartbeat === 7)).toBe(true);
        expect(ctx.yesimbot.tool.getTool("ban")).toBeUndefined();
        expect(await run(ctx, "extension.enable", "qmanager")).toBe("启用成功");
        await ctx.yesimbot.ready;
        await ctx.lifecycle.flush();
        expect(ctx.yesimbot.config.extra?.qmanager?.enabled).toBe(true);
        expect(ctx.yesimbot.tool.getTool("ban")).toBeTruthy();
        expect(await run(ctx, "conf.set", "heartbeat 8")).toBe("设置成功");
        await ctx.yesimbot.ready;
        await ctx.lifecycle.flush();
        expect(ctx.yesimbot.config.heartbeat).toBe(8);
        expect(ctx.yesimbot.agent.config.heartbeat).toBe(8);
    } finally {
        await ctx.stop();
        await rm(baseDir, { recursive: true, force: true });
    }
});

@Extension({ name: "decorated-external", version: "1", description: "external lifecycle probe" })
class DecoratedExternal {
    static Config = Schema.object({ token: Schema.string().default("keep") });
    constructor(
        public ctx: Context,
        public config: any,
    ) {}
    @Tool({ name: "decorated_probe", description: "probe", parameters: Schema.object({}) })
    async probe() {
        return { status: "success" };
    }
}
it("re-enables a disabled decorated external plugin through its own scope", async () => {
    const ctx = app(),
        manager = service(ctx);
    ctx.set("yesimbot", { tool: manager });
    (manager as any).registerCommands();
    ctx.plugin(DecoratedExternal, { enabled: false, token: "original" });
    await ctx.start();
    expect(manager.getTool("decorated_probe")).toBeUndefined();
    expect(await run(ctx, "extension.enable", "decorated-external")).toBe("启用成功");
    await ctx.lifecycle.flush();
    expect(manager.getExtension("decorated-external")?.config.token).toBe("original");
    expect(manager.getTool("decorated_probe")).toBeTruthy();
    expect(await run(ctx, "extension.disable", "decorated-external")).toBe("禁用成功");
    await ctx.lifecycle.flush();
    expect(manager.getTool("decorated_probe")).toBeUndefined();
});

const collidingExtension = () =>
    Extension({ name: "decorator-collision", version: "1", description: "collision" })(
        class {
            tools = new Map([["decorated_shared", tool("decorated_shared")]]);
            constructor(
                public ctx: Context,
                public config: any,
            ) {}
        },
    ) as any;

it("the decorator passes instance identity when disposing an older colliding extension", async () => {
    const ctx = app(),
        manager = service(ctx);
    ctx.set("yesimbot", { tool: manager });
    const old = ctx.plugin(collidingExtension());
    ctx.plugin(collidingExtension());
    await ctx.start();
    const replacement = manager.getTool("decorated_shared");
    expect(replacement).toBeTruthy();
    old.dispose();
    expect(manager.getTool("decorated_shared")).toBe(replacement);
});
