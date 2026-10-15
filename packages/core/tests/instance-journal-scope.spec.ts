import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Context, Service } from "koishi";
import { afterEach, expect, it } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { Config } from "../src/config";
import { getInstanceDirectory, getInstanceScope } from "../src/shared/instance-scope";
import { InteractionManager } from "../src/world/interaction-manager";
import { stubCtx } from "./helpers/yesimbot";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const manager = (ctx: any) => new InteractionManager(ctx, { logLengthLimit: 1 } as any, ctx.yesimbot.logging);
const turns = async (m: InteractionManager) => (await m.getL1History("qq", "group", 10)).map((r) => (r as any).turnId);

async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-instance-journal-"));
    roots.push(root);
    const context = (key?: string): any =>
        stubCtx(
            { logging: { getLogger: () => ({ info() {}, error() {}, debug() {}, warn() {} }) } },
            {
                baseDir: root,
                scope: key ? { key, parent: {} } : {},
                database: { get: async () => [] },
            },
        );
    return { root, context, manager, turns };
}

it("isolates same-channel thoughts and cleanup by stable plugin instance across restarts", async () => {
    const f = await fixture();
    const a = f.manager(f.context("yesimbot:a"));
    const b = f.manager(f.context("yesimbot:b"));
    await a.recordHeartbeat("a", "qq", "group", 1, 2);
    await b.recordHeartbeat("b", "qq", "group", 1, 2);
    expect(await f.turns(a)).toEqual(["a"]);
    expect(await f.turns(b)).toEqual(["b"]);
    const restarted = f.manager(f.context("yesimbot:a"));
    expect(await f.turns(restarted)).toEqual(["a"]);
    await restarted.clearAgentHistory();
    await restarted.pruneOldData();
    expect(await f.turns(b)).toEqual(["b"]);
});

it("never reads, discovers, prunes or clears unowned pre-instance logs", async () => {
    const f = await fixture();
    const legacy = path.join(f.root, "data/yesimbot/interactions/qq/group.agent.jsonl");
    const content =
        JSON.stringify({ type: "agent_heartbeat", turnId: "legacy", platform: "qq", channelId: "group", timestamp: new Date().toISOString() }) + "\n";
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, content);
    const manager = f.manager(f.context("yesimbot:a"));
    expect(await f.turns(manager)).toEqual([]);
    expect(await manager.getAgentChannels()).toEqual([]);
    expect(await manager.getAgentHistoryForDateRange("qq", "group", new Date(0), new Date(Date.now() + 1000))).toEqual([]);
    await manager.pruneOldData();
    await manager.clearAgentHistory();
    expect(await fs.readFile(legacy, "utf8")).toBe(content);
});

it("keeps unmanaged instances independent instead of guessing ownership", async () => {
    const f = await fixture();
    const a = f.manager(f.context());
    const b = f.manager(f.context());
    await a.recordHeartbeat("a", "qq", "group", 1, 2);
    expect(await f.turns(b)).toEqual([]);
});

it("resolves internal services through the owning instance and loader MainScope fork across reloads", async () => {
    const f = await fixture();
    const owner = f.context();
    const main: any = { parent: {}, children: [{ key: "yesimbot:a" }] };
    main.runtime = main;
    owner.scope = main;
    const child = { ...f.context("internal-service"), get: () => ({ ctx: owner }) } as any;
    expect(getInstanceScope(child)).toBe(getInstanceScope(f.context("yesimbot:a")));
    expect(getInstanceScope(child)).not.toBe(getInstanceScope(f.context("yesimbot:b")));
    expect(getInstanceDirectory(child, "custom/root")).toBe(getInstanceDirectory(owner, path.join(f.root, "custom/root")));
});

it("keeps ancestor key chains distinct and ambiguous shared runtimes closed", async () => {
    const f = await fixture();
    const a = f.context("same");
    const b = f.context("same");
    a.scope.parent.scope = { key: "group:a", parent: {} };
    b.scope.parent.scope = { key: "group:b", parent: {} };
    expect(getInstanceScope(a)).not.toBe(getInstanceScope(b));
    const ambiguous = f.context();
    ambiguous.scope.runtime = ambiguous.scope;
    ambiguous.scope.children = [{ key: "yesimbot:a" }, { key: "yesimbot:b" }];
    ambiguous.scope.parent = { scope: { key: "group:a" } };
    expect(getInstanceScope(ambiguous)).not.toBe(getInstanceScope(a));
    expect(getInstanceScope(ambiguous)).toBe(getInstanceScope(ambiguous));
    expect(getInstanceScope(f.context())).not.toBe(getInstanceScope(ambiguous));
});

it("AgentCore journals isolate shared configured roots, preserve locks, and restore only the same instance", async () => {
    const f = await fixture();
    const cores: any[] = [];
    const create = (key: string) => {
        const ctx = new Context();
        Object.defineProperty(ctx, "baseDir", { value: f.root });
        // A stable loader entry is carried by the owning YesImBot context.
        ctx.set("yesimbot", { ctx: f.context(key) });
        ctx.yesimbot.logging = f.context().yesimbot.logging;
        ctx.yesimbot.world = { l1_manager: {} } as any;
        ctx.yesimbot.model = { useChatGroup: () => ({}) } as any;
        ctx.yesimbot.prompt = {} as any;
        ctx.database = { get: async () => [], upsert: async () => {}, remove: async () => {} } as any;
        const core: any = new AgentCore(ctx, Config({ decisionRecording: { enabled: true, directory: "custom-decisions" } }), ctx.yesimbot as any);
        cores.push(core);
        return core;
    };
    const legacy = path.join(f.root, "custom-decisions/decisions.jsonl");
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, "unowned legacy decision\n");
    try {
        const a = create("yesimbot:a");
        const b = create("yesimbot:b");
        const target = { platform: "qq", selfId: "bot", channelId: "group", isDirect: false };
        a.decisions.begin(target, "user_message");
        b.decisions.begin(target, "user_message");
        const aRows = await a.decisionJournal.list();
        const bRows = await b.decisionJournal.list();
        expect(aRows).toHaveLength(1);
        expect(bRows).toHaveLength(1);
        expect(aRows[0].id).not.toBe(bRows[0].id);
        expect(a.decisionJournal.filePath).not.toBe(b.decisionJournal.filePath);
        const blocked = create("yesimbot:a");
        expect(await blocked.decisionJournal.list()).toEqual([]);
        expect(JSON.parse(await fs.readFile(path.join(path.dirname(a.decisionJournal.filePath), ".decisions.lock"), "utf8")).pid).toBe(process.pid);
        await blocked.stop();
        await a.stop();
        const restarted = create("yesimbot:a");
        expect((await restarted.decisionJournal.list()).map((row: any) => row.id)).toEqual(aRows.map((row: any) => row.id));
        expect(await fs.readFile(legacy, "utf8")).toBe("unowned legacy decision\n");
    } finally {
        for (const core of cores) await core.stop();
    }
});

it("uses the original owner behind real Cordis service proxies without undeclared injection warnings", async () => {
    const f = await fixture();
    class Owner extends Service {
        constructor(ctx: Context) {
            super(ctx, "yesimbot", true);
        }
    }
    const createOwner = () => {
        const ctx = new Context();
        Object.defineProperty(ctx, "baseDir", { value: f.root });
        (ctx.scope as any).key = "yesimbot:stable";
        ctx.set("yesimbot", new Owner(ctx));
        return ctx;
    };
    const owner = createOwner();
    const warnings: string[] = [];
    owner.on("internal/warning", (error) => warnings.push(error.message));
    const caller = owner.extend();
    Object.defineProperty(caller, "scope", { value: { key: "internal-service", parent: {} } });
    expect(caller.get("yesimbot").ctx).toBe(caller);
    expect(getInstanceScope(caller)).toBe(getInstanceScope(owner));
    expect(getInstanceScope(caller)).toBe(getInstanceScope(createOwner()));
    const empty = new Context();
    empty.on("internal/warning", (error) => warnings.push(error.message));
    getInstanceScope(empty);
    expect(warnings).toEqual([]);
});

it("allows extensions sharing a core to explicitly retain their own plugin scopes", async () => {
    const f = await fixture();
    const core = f.context("yesimbot:core");
    const a = { ...f.context("durable:a"), get: () => ({ ctx: core }) } as any;
    const b = { ...f.context("durable:b"), get: () => ({ ctx: core }) } as any;
    expect(getInstanceScope(a)).toBe(getInstanceScope(b));
    expect(getInstanceScope(a, undefined, { owner: a })).not.toBe(getInstanceScope(b, undefined, { owner: b }));
});
