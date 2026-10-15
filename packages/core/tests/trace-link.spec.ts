import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "koishi";
import { expect, it } from "vitest";

import { DecisionJournal } from "../src/agent/decision-journal";
import { DecisionRecords } from "../src/agent/decision-record";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { getContextSnapshots } from "../src/services/model/context-snapshot";
import { getUsageLedger, observeUsageFetch, withUsageScope } from "../src/services/model/usage";
import { Services } from "../src/shared/constants";
import { journalOptions, record, temporary } from "./helpers/decision-fixtures";

for (const mode of ["normal", "streaming", "native"]) {
    it(`links ${mode} heartbeat iterations, nested model requests and tool logs to the decision id`, async () => {
        const baseDir = await mkdtemp(path.join(tmpdir(), "trace-link-"));
        const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
        const ctx: any = { baseDir, on() {}, [Services.Logger]: { getLogger: () => logger } };
        const ledger = getUsageLedger(ctx);
        const turns: string[] = [];
        const observations: any[] = [];
        let requests = 0;
        const transport = async (model: string) => {
            const response = await observeUsageFetch(
                ctx,
                { provider: "test", model },
                async () => new Response("{}"),
            )("https://test.invalid", { body: '{"messages":[]}' });
            await response.text();
        };
        const processor = new HeartbeatProcessor(
            ctx,
            { heartbeat: 2, streamAction: mode === "streaming", nativeToolCalling: mode === "native" } as any,
            {
                chat: async () => {
                    await transport("chat");
                    return { text: JSON.stringify({ thoughts: {}, actions: [{ function: "probe", params: {} }], request_heartbeat: ++requests < 2 }) };
                },
            } as any,
            {} as any,
            {
                getAvailableTools: () => [{ name: "probe", description: "test", parameters: Schema.object({}) }],
                invoke: async () => {
                    await transport("tool");
                    return { status: "success" };
                },
            } as any,
            {
                recordThought: async (id: string) => {
                    turns.push(id);
                },
                recordHeartbeat: async (id: string) => {
                    turns.push(id);
                },
                recordAction: async (id: string) => {
                    turns.push(id);
                    return "action";
                },
                recordObservation: async (_id: string, _platform: string, _channel: string, observation: any) => {
                    observations.push(observation);
                },
            } as any,
            {} as any,
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [], manualRecallIds: [] });
        try {
            await processor.runCycle({ decisionId: "decision-123", session: { platform: "onebot", selfId: "bot", channelId: "group" } } as any);
            expect(turns.length).toBeGreaterThan(2);
            expect(new Set(turns)).toEqual(new Set(["decision-123"]));
            expect(observations.every((entry) => entry.turnId === "decision-123")).toBe(true);
            expect(getContextSnapshots(ctx).map((snapshot) => snapshot.traceId)).toEqual(["decision-123", "decision-123"]);
            expect((await ledger.snapshot()).records.every((entry) => !("traceId" in entry))).toBe(true);
        } finally {
            await ledger.close();
            await rm(baseDir, { recursive: true, force: true });
        }
    });
}

it("retains only bounded recent per-trace snapshots instead of replacing unrelated concurrent traces", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "trace-snapshots-"));
    const ctx: any = { baseDir, on() {} };
    const ledger = getUsageLedger(ctx);
    try {
        await Promise.all(
            Array.from({ length: 140 }, (_, index) =>
                withUsageScope({ traceId: `trace-${index}` }, async () => {
                    const response = await observeUsageFetch(
                        ctx,
                        { provider: "test", model: "chat" },
                        async () => new Response("{}"),
                    )("https://test.invalid", { body: '{"messages":[]}' });
                    await response.text();
                }),
            ),
        );
        const snapshots = getContextSnapshots(ctx);
        expect(snapshots).toHaveLength(128);
        expect(new Set(snapshots.map((snapshot) => snapshot.traceId)).size).toBe(128);
        expect((await ledger.snapshot()).records).toHaveLength(1);
    } finally {
        await ledger.close();
        await rm(baseDir, { recursive: true, force: true });
    }
});

it("retains bounded source message ids across journal reload and exact trace queries", async (t) => {
    const dir = await temporary(t);
    const target = { platform: "onebot", selfId: "bot", channelId: "group" };
    const records = new DecisionRecords();
    const id = records.begin(target, "user_message", "message-123");
    const journal = new DecisionJournal(dir, journalOptions);
    await journal.append(records.latest(target)!);
    await journal.append(record("other"));
    await journal.close();
    const restored = new DecisionJournal(dir, journalOptions);
    t.onTestFinished(() => restored.close());
    expect(await restored.list({ traceId: id })).toMatchObject([{ id, messageId: "message-123" }]);
    expect(await restored.list({ traceId: id, key: "unrelated" })).toEqual([]);
    records.begin(target, "user_message", "x".repeat(513));
    expect(records.latest(target)?.messageId).toBeUndefined();
});
