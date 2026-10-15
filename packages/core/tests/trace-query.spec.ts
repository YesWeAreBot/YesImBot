import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import pluginMock from "@koishijs/plugin-mock";
import { Context } from "koishi";
import { expect, it } from "vitest";

import { captureContextSnapshot, getContextSnapshots } from "../src/model/context-snapshot";
import { getUsageLedger } from "../src/model/usage";
import { HistoryCommandManager } from "../src/world/commands";
import { parseInspectionOptions, registerHistoryInspection } from "../src/world/history-inspection";
import { loggingStub } from "./helpers/yesimbot";

it("provides a recall example whose options survive Koishi's greedy text argument", () => {
    const app = new Context();
    new HistoryCommandManager(app, {} as any, {} as any, loggingStub()).register();
    const command = app.$commander.get("history.recall")!;
    const example = command._examples[0].replace(/^history\.recall\s+/, "");
    const parsed = command.parse(example);
    expect(parsed.options).toMatchObject({ kind: "messages", display: true });
    expect(parsed.args).toEqual(["旅行"]);
});

it("rejects help and short options as missing filter values while preserving explicitly quoted values", () => {
    for (const option of ["-h", "-x", "--full"]) {
        expect(() => parseInspectionOptions(`history.context --provider ${option}`)).toThrow("--provider 缺少参数");
    }
    expect(parseInspectionOptions('history.context --provider "-h"').provider).toEqual(["-h"]);
    expect(parseInspectionOptions("history.context --provider=-h").provider).toEqual(["-h"]);
});

it("returns a useful missing-provider error through real Koishi command dispatch", async (t) => {
    const app = new Context();
    t.onTestFinished(() => app.stop());
    app.plugin(memory);
    app.plugin((pluginMock as any).default ?? pluginMock);
    app.plugin((ctx) => registerHistoryInspection(ctx, ctx.command("history", "历史", { authority: 3 })));
    await app.start();
    await app.mock.initUser("admin", 3);
    await app.mock.initChannel("group");
    const output = (await app.mock.client("admin", "group").receive("history.context --provider -h")).join("\n");
    expect(output).toContain("--provider 缺少参数");
    const command = app.$commander.get("history.context")!;
    expect(String(command._usage)).toContain("--target");
    expect(command._examples).toContain("history.context --adapter onebot --target onebot:857518324");
});

it("accepts an exact bounded trace option and prevents trace from being ignored during a statistics reset", () => {
    expect(parseInspectionOptions('history.context --trace "exact-id"').traceId).toBe("exact-id");
    expect(parseInspectionOptions("", { trace: "from-options" }).traceId).toBe("from-options");
    for (const trace of ["", "x".repeat(513), "bad\ntrace"]) expect(() => parseInspectionOptions("", { trace })).toThrow("512");
    expect(() => parseInspectionOptions("history.tokens --reset --trace id")).toThrow("重置");
});

it("queries a trace's snapshots with the existing target filters and exposes its correlation id", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "trace-query-"));
    const ctx: any = { baseDir, on() {} };
    const ledger = getUsageLedger(ctx);
    const handlers = new Map<string, any>();
    const history: any = {
        subcommand(name: string, _description: string, options: any) {
            expect(options.authority).toBe(3);
            const command: any = {
                option() {
                    return command;
                },
                action(fn: any) {
                    handlers.set(name, fn);
                    return command;
                },
            };
            return command;
        },
    };
    try {
        for (const [traceId, target] of [
            ["exact-id", "room"],
            ["exact-id", "other"],
            ["exact-id-extra", "room"],
        ]) {
            captureContextSnapshot(
                ctx,
                { traceId, platform: "onebot", botId: "bot", target, provider: "provider", model: "model" },
                { messages: [{ role: "user", content: `${traceId}/${target}` }] },
                "period",
            );
        }
        registerHistoryInspection(ctx, history);
        const result = await handlers.get(".context")({
            session: { platform: "onebot", userId: "operator" },
            source: "history.context --trace exact-id --target onebot:room --details",
        });
        expect(result).toContain("Trace ID：exact-id");
        expect(result).toContain("exact-id/room");
        expect(result).not.toContain("exact-id/other");
        expect(result).not.toContain("exact-id-extra");
        expect(getContextSnapshots(ctx, "exact-id")).toHaveLength(2);
        expect(await handlers.get(".tokens")({ session: { platform: "onebot", userId: "operator" }, source: "history.tokens --trace exact-id" })).toContain(
            "仅 history.context",
        );
    } finally {
        await ledger.close();
        await rm(baseDir, { recursive: true, force: true });
    }
});
