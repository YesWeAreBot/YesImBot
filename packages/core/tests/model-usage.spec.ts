import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { getContextSnapshots } from "../src/model/context-snapshot";
import { estimateTokens, getUsageLedger, normalizeUsage, observeUsageFetch, withUsageScope } from "../src/model/usage";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
    const baseDir = await mkdtemp(path.join(tmpdir(), "model-usage-"));
    const ctx: any = { baseDir, on() {} };
    const ledger = getUsageLedger(ctx);
    await ledger.ready();
    cleanups.push(async () => {
        await ledger.close();
        await rm(baseDir, { recursive: true, force: true });
    });
    return { ctx, ledger };
}
const metadata = { provider: "test", model: "model" };

it("returns non-2xx headers without waiting for telemetry to consume an unfinished body", async () => {
    const { ctx, ledger } = await fixture();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const original = new Response(
        new ReadableStream({
            start(controller) {
                bodyController = controller;
            },
        }),
        { status: 503 },
    );
    const request = observeUsageFetch(ctx, metadata, async () => original)("https://test.invalid");
    const outcome = await Promise.race([request.then(() => "response"), new Promise((resolve) => setTimeout(() => resolve("blocked"), 50))]);
    bodyController.enqueue(new TextEncoder().encode('{"usage":{"input_tokens":2}}'));
    bodyController.close();
    const response = await request;
    await response.text();
    expect(outcome).toBe("response");
    expect((await ledger.snapshot()).records[0]).toMatchObject({ status: "http-503", api: { in: 2 } });
});

for (const streaming of [false, true]) {
    it(`includes Anthropic system and tool output in ${streaming ? "stream" : "nonstream"} estimates`, async () => {
        const { ctx, ledger } = await fixture();
        const payload = { system: "Remember my long system instruction", messages: [{ role: "user", content: "hello" }], stream: streaming };
        const usage = { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3 };
        const responseBody = streaming
            ? [
                  { type: "message_start", message: { usage: { ...usage, output_tokens: 0 } } },
                  { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "lookup", input: {} } },
                  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"hi"}' } },
                  { type: "message_delta", usage: { output_tokens: 4 } },
              ]
                  .map((data) => `data: ${JSON.stringify(data)}\n\n`)
                  .join("")
            : JSON.stringify({ content: [{ type: "tool_use", name: "lookup", input: { q: "hi" } }], usage });
        const response = await observeUsageFetch(
            ctx,
            metadata,
            async () => new Response(responseBody, { headers: { "content-type": streaming ? "text/event-stream" : "application/json" } }),
        )("https://test.invalid", { body: JSON.stringify(payload) });
        await response.text();
        const record = (await ledger.snapshot()).records[0];
        expect(record.api).toMatchObject({ in: 13, out: 4, total: 17 });
        expect(record.local.in).toBe(estimateTokens({ messages: payload.messages, system: payload.system }));
        expect(record.local.out).toBe(estimateTokens('lookup{"q":"hi"}'));
        expect(getContextSnapshots(ctx)[0].inputTokens).toBeGreaterThan(10);
    });
}

it("includes nested Anthropic cache creation in the total input", () => {
    expect(normalizeUsage({ input_tokens: 2, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 4 } })).toEqual({
        in: 9,
        out: 1,
        cr: null,
        cw: 7,
        total: 10,
    });
});

for (const name of ["AbortError", "TimeoutError"]) {
    it(`records an aborted request as ${name === "TimeoutError" ? "timeout" : "cancelled"}`, async () => {
        const { ctx, ledger } = await fixture();
        const controller = new AbortController();
        const reason = new DOMException("stop", name);
        const fetch = observeUsageFetch(ctx, metadata, async () => {
            controller.abort(reason);
            throw reason;
        });
        await expect(fetch("https://test.invalid", { signal: controller.signal })).rejects.toBe(reason);
        expect((await ledger.snapshot()).records[0].status).toBe(name === "TimeoutError" ? "timeout" : "cancelled");
    });
}

it("allows a scope to explicitly clear a triggering bot identity", async () => {
    const { ledger } = await fixture();
    const ticket = withUsageScope({ platform: "chat", botId: "bot", target: "room" }, () =>
        withUsageScope({ purpose: "background", botId: undefined, target: undefined }, () => ledger.begin(metadata)),
    );
    expect(ticket.botId).toBeUndefined();
    expect(ticket.target).toBeUndefined();
    expect(ticket.platform).toBe("chat");
});

it("binds budget diagnostics to the transport snapshot without persisting them in usage totals", async () => {
    const { ctx, ledger } = await fixture();
    const report = { originalInputTokens: 30, inputTokens: 20, droppedMessages: 2 };
    const response = await withUsageScope({ contextBudget: report }, () =>
        observeUsageFetch(ctx, metadata, async () => new Response("{}"))("https://test.invalid", { body: '{"messages":[]}' }),
    );
    await response.text();
    expect(getContextSnapshots(ctx)[0].contextBudget).toEqual(report);
    expect((await ledger.snapshot()).records[0]).not.toHaveProperty("contextBudget");
});

for (const streaming of [false, true]) {
    it(`passes oversized ${streaming ? "SSE" : "JSON"} bytes through while leaving response estimates unknown`, async () => {
        const { ctx, ledger } = await fixture();
        const body = streaming
            ? `data: ${JSON.stringify({ choices: [{ delta: { content: "x".repeat(3_000_000) } }] })}\n\n`
            : JSON.stringify({ choices: [{ message: { content: "x".repeat(3_000_000) } }], usage: { prompt_tokens: 2 } });
        const response = await observeUsageFetch(
            ctx,
            metadata,
            async () => new Response(body, { headers: { "content-type": streaming ? "text/event-stream" : "application/json" } }),
        )("https://test.invalid");
        expect(await response.text()).toBe(body);
        expect((await ledger.snapshot()).records[0]).toMatchObject({ status: "success", local: { out: null }, api: { in: null } });
    });
}

for (const name of ["AbortError", "TimeoutError"]) {
    it(`preserves ${name} and partial output after the body fails`, async () => {
        const { ctx, ledger } = await fixture();
        const controller = new AbortController();
        const reason = new DOMException("stop", name);
        let reads = 0;
        const response = await observeUsageFetch(
            ctx,
            metadata,
            async () =>
                new Response(
                    new ReadableStream({
                        pull(body) {
                            if (reads++ === 0) body.enqueue(new TextEncoder().encode('data: {"delta":{"text":"partial"}}\n\n'));
                            else {
                                controller.abort(reason);
                                body.error(reason);
                            }
                        },
                    }),
                    { headers: { "content-type": "text/event-stream" } },
                ),
        )("https://test.invalid", { signal: controller.signal });
        await expect(response.text()).rejects.toBe(reason);
        expect((await ledger.snapshot()).records[0]).toMatchObject({
            status: name === "TimeoutError" ? "timeout" : "cancelled",
            local: { out: estimateTokens("partial") },
        });
    });
}

it("keeps concurrent usage scopes isolated and permits a fully detached worker scope", async () => {
    const { ledger } = await fixture();
    const tickets = await withUsageScope({ platform: "chat", botId: "bot", target: "room" }, () =>
        Promise.all([
            withUsageScope({ purpose: "chat" }, async () => {
                await Promise.resolve();
                return ledger.begin(metadata);
            }),
            withUsageScope(
                { purpose: "worker" },
                async () => {
                    await Promise.resolve();
                    return ledger.begin(metadata);
                },
                false,
            ),
        ]),
    );
    expect(tickets[0]).toMatchObject({ platform: "chat", botId: "bot", target: "room", purpose: "chat" });
    expect(tickets[1]).toMatchObject({ purpose: "worker" });
    expect(tickets[1].platform).toBeUndefined();
    expect(tickets[1].botId).toBeUndefined();
    expect(tickets[1].target).toBeUndefined();
});
