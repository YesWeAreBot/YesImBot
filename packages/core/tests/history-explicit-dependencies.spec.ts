import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { captureContextSnapshot } from "../src/model/context-snapshot";
import { getUsageLedger } from "../src/model/usage";
import { registerHistoryInspection } from "../src/world/history-inspection";

it("history inspection uses the owning model and memory without looking up its own facade", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yib-history-deps-"));
    const ctx: any = { baseDir, on() {}, logger: () => ({ warn() {} }), bots: [], database: { get: async () => [] } };
    Object.defineProperty(ctx, "yesimbot", {
        get() {
            throw new Error("undeclared yesimbot lookup");
        },
    });
    const usageOwner = { context: ctx };
    const ledger = getUsageLedger(ctx, usageOwner);
    try {
        captureContextSnapshot(ctx, { provider: "p", model: "m" }, { messages: [{ role: "user", content: "hello" }] }, "period", undefined, usageOwner);
        const actions = new Map<string, any>();
        const command = (name: string): any => ({
            subcommand: (sub: string) => command(sub),
            option() {
                return this;
            },
            usage() {},
            example() {},
            action(fn: any) {
                actions.set(name, fn);
            },
        });
        registerHistoryInspection(ctx, command("history"), {
            model: { usageOwner, peekContextLimit: () => ({ tokens: 1234, mode: "known", source: "fixture" }) },
            memory: { getMemoryBlocksForRendering: () => [{ content: "memory" }] },
        });
        const session = { platform: "test", userId: "admin" };
        const tokens = await actions.get(".tokens")({ session, source: "history.tokens" });
        expect(tokens).toContain("无匹配记录");
        const context = await actions.get(".context")({ session, source: "history.context" });
        expect(context).toContain("1 个区块");
        expect(context).toContain("最近快照 1 条");
        expect(context).toContain("1.234K");
    } finally {
        await ledger.close();
        await rm(baseDir, { recursive: true, force: true });
    }
});
