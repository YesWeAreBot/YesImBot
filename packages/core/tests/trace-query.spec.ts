import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { captureContextSnapshot, getContextSnapshots } from "../src/services/model/context-snapshot";
import { getUsageLedger } from "../src/services/model/usage";
import { parseInspectionOptions, registerHistoryInspection } from "../src/services/worldstate/history-inspection";

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
