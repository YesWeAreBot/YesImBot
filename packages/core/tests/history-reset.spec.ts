import { expect, it, vi } from "vitest";

import { prepareHistoryReset, registerHistoryResetParticipant } from "../src/world/history-reset";

it("invalidates every participant synchronously, drains before deletion and releases after failure", async () => {
    const ctx: any = {};
    const calls: string[] = [];
    let drain!: () => void;
    const draining = new Promise<void>((resolve) => {
        drain = resolve;
    });
    const unregister = registerHistoryResetParticipant(ctx, {
        prepare() {
            calls.push("invalidate");
            return {
                ready: draining.then(() => {
                    calls.push("drained");
                }),
                release: () => {
                    calls.push("release");
                },
            };
        },
    });
    const reset = prepareHistoryReset(ctx, { type: "all" });
    expect(calls).toEqual(["invalidate"]);
    let ready = false;
    const waiting = reset.ready.then(() => {
        ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    drain();
    await waiting;
    await reset.finish();
    await reset.finish();
    expect(calls).toEqual(["invalidate", "drained", "release"]);
    unregister();
});

it("notifies only participants attached to the selected core and releases successful participants if another fails", async () => {
    const owner: any = {};
    const service = Object.defineProperty({}, "ctx", { value: owner });
    const core: any = { get: () => service };
    const extension: any = { get: () => service };
    const foreign: any = {};
    const release = vi.fn<() => void>();
    const unrelated = vi.fn<() => void>();
    const stops = [
        registerHistoryResetParticipant(extension, { prepare: () => ({ release }) }),
        registerHistoryResetParticipant(core, {
            prepare: () => {
                throw new Error("drain failed");
            },
        }),
        registerHistoryResetParticipant(foreign, { prepare: unrelated }),
    ];
    const reset = prepareHistoryReset(core, { type: "all" });
    await expect(reset.ready).rejects.toThrow("drain failed");
    await reset.finish();
    expect(release).toHaveBeenCalledTimes(1);
    expect(unrelated).not.toHaveBeenCalled();
    stops.forEach((stop) => stop());
});

it("releases a participant even if its asynchronous drain fails", async () => {
    const ctx: any = {};
    const release = vi.fn<() => void>();
    const unregister = registerHistoryResetParticipant(ctx, { prepare: () => ({ ready: Promise.reject(new Error("purge failed")), release }) });
    const reset = prepareHistoryReset(ctx, { type: "all" });
    await expect(reset.ready).rejects.toThrow("purge failed");
    await reset.finish();
    expect(release).toHaveBeenCalledOnce();
    unregister();
});

it.each(["success", "delete failure", "participant failure"] as const)("releases the real clear command after %s", async (outcome) => {
    const { HistoryCommandManager } = await import("../src/world/commands");
    const { SemanticMemoryManager } = await import("../src/world/l2-semantic-memory");
    const commands = new Map<string, Function>();
    const command = (name: string): any => {
        const value: any = {
            subcommand: (suffix: string) => command(name + suffix),
            action: (callback: Function) => {
                commands.set(name, callback);
                return value;
            },
        };
        for (const method of ["option", "usage", "example"]) value[method] = () => value;
        return value;
    };
    const logger = { info() {}, warn() {}, debug() {}, error() {} };
    const remove = vi.fn<(...args: any[]) => Promise<any>>(async () => {
        if (outcome === "delete failure") throw new Error("delete failed");
        return { removed: 0 };
    });
    const ctx: any = { command, logger, database: { get: async () => [], remove } };
    const logging: any = { getLogger: () => logger };
    const memory = new SemanticMemoryManager(ctx, { l2_memory: { enabled: false } } as any, logging, {} as any);
    const service: any = { l2_manager: memory, l1_manager: { clearAgentHistory: async () => 0 }, recordSystemEvent: async () => {} };
    new HistoryCommandManager(ctx, service, {} as any, logging).register();
    const release = vi.fn<() => void>();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((r, j) => {
        resolve = r;
        reject = j;
    });
    const stop = registerHistoryResetParticipant(ctx, { prepare: () => ({ ready, release }) });
    try {
        const pending = commands.get("history.clear")!({ session: { platform: "qq", channelId: "room" }, options: { all: "all" } });
        expect(memory.getHistoryGeneration({ platform: "qq", channelId: "room" })).toBe(1);
        expect(remove).not.toHaveBeenCalled();
        if (outcome === "participant failure") reject(new Error("purge failed"));
        else resolve();
        const result = await pending;
        expect(release).toHaveBeenCalledOnce();
        expect(result).toContain(outcome === "success" ? "操作成功" : "失败");
        expect(remove).toHaveBeenCalledTimes(outcome === "participant failure" ? 0 : outcome === "delete failure" ? 1 : 4);
    } finally {
        stop();
    }
});

it("preserves participant reports on both successful and failed resets", async () => {
    const ctx: any = {};
    const stop = registerHistoryResetParticipant(ctx, {
        prepare: () => ({
            ready: Promise.reject(new Error("delete failed")),
            report: () => "人物记忆：清理1个自有范围，保留1个共享范围。",
        }),
    });
    try {
        const reset = prepareHistoryReset(ctx, { type: "all" });
        await expect(reset.ready).rejects.toThrow("delete failed");
        await reset.finish();
        expect(reset.reports()).toEqual(["人物记忆：清理1个自有范围，保留1个共享范围。"]);
    } finally {
        stop();
    }
});

it("shares lifecycle registrations between real ESM and CJS bundles", async () => {
    const { build } = await import("esbuild");
    const fs = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { default: path } = await import("node:path");
    const { pathToFileURL, fileURLToPath } = await import("node:url");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const directory = await fs.mkdtemp(path.join(tmpdir(), "yib-reset-bundles-"));
    try {
        const entry = fileURLToPath(new URL("../src/world/history-reset.ts", import.meta.url));
        const esmPath = path.join(directory, "reset.mjs"),
            cjsPath = path.join(directory, "reset.cjs");
        await Promise.all([
            build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: esmPath }),
            build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: cjsPath }),
        ]);
        const script = `
            import { createRequire } from 'node:module';
            import assert from 'node:assert/strict';
            const esm = await import(${JSON.stringify(pathToFileURL(esmPath).href)});
            const cjs = createRequire(import.meta.url)(${JSON.stringify(cjsPath)});
            const owner = {};
            const service = Object.defineProperty({}, 'ctx', { value: owner });
            const core = { get: () => service }, extension = { get: () => service };
            let calls = 0;
            const stop = esm.registerHistoryResetParticipant(extension, { prepare() { calls++; } });
            const reset = cjs.prepareHistoryReset(core, { type: 'all' });
            await reset.ready;
            await reset.finish();
            assert.equal(calls, 1);
            stop();
            await cjs.prepareHistoryReset(core, { type: 'all' }).finish();
            assert.equal(calls, 1);
        `;
        await expect(promisify(execFile)(process.execPath, ["--input-type=module", "-e", script])).resolves.toMatchObject({ stderr: "" });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
