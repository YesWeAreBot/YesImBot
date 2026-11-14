import { expect, it } from "vitest";

import { ConversationReportRecorder, withConversationReport } from "../src/logger/conversation-report";
import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { observeModelReportRequest, observeModelReportTransport, withModelConversationReport } from "../src/model/conversation-capture";
import { createNativeFetch } from "../src/model/native-fetch";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const source = { requestId: "chat-71", provider: "test-provider", model: "test-model", purpose: "测试" };
const endpoint = "https://provider.example/v1/chat/completions";
const target = { platform: "onebot", selfId: "12345678", channelId: "23456789" };
const frameworkBody = JSON.stringify({
    model: "test-model",
    messages: [
        { role: "system", content: "rendered system prompt" },
        { role: "user", content: "latest chat context" },
    ],
    tools: [{ type: "function", function: { name: "get_time", parameters: { type: "object" } } }],
});

it("captures final prompts and exact native JSON before conversion, without exposing transport credentials", async () => {
    const report = new ConversationReportRecorder();
    const original = JSON.stringify({ candidates: [{ content: { parts: [{ text: "native result" }] }, finishReason: "STOP" }] });
    const provider = createNativeFetch(
        { type: "Google Gemini", baseURL: "https://provider.example/v1/", apiKey: "not-for-the-report" } as any,
        observeModelReportTransport(async () => Response.json(JSON.parse(original))),
    );
    await withConversationReport(report.start(target, "turn-1"), async () => {
        const normalized = await withModelConversationReport(source, async () => {
            const response = await observeModelReportRequest(provider)(endpoint, { method: "POST", body: frameworkBody });
            return response.json();
        });
        expect(normalized.choices[0].message.content).toBe("native result");
        const entries = report.snapshot()?.entries;
        expect(entries).toMatchObject([
            { kind: "model.request", data: { ...source, wireRequest: 1, payload: JSON.parse(frameworkBody) } },
            {
                kind: "model.provider_request",
                data: { ...source, wireRequest: 1, payload: { systemInstruction: { parts: [{ text: "rendered system prompt" }] } } },
            },
            { kind: "model.response", data: { ...source, wireRequest: 1, status: 200, outcome: "complete", raw: original } },
        ]);
        expect(JSON.stringify(entries)).not.toContain("not-for-the-report");
        expect(JSON.stringify(entries)).not.toContain(endpoint);
    });
});

it("records a partial stream by the time the model call fails, without masking the source error", async () => {
    const report = new ConversationReportRecorder();
    const sourceError = new Error("socket disconnected");
    let pulls = 0;
    const start = 'data: {"delta":"第一行"}\n\n';
    const payload = new TextEncoder().encode(start);
    const stream = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (pulls === 0) controller.enqueue(payload.subarray(0, 19));
                else if (pulls === 1) controller.enqueue(payload.subarray(19));
                else controller.error(sourceError);
                pulls++;
            },
        },
        { highWaterMark: 0 },
    );
    const request = observeModelReportRequest(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    await withConversationReport(report.start(target, "turn-2"), async () => {
        await expect(withModelConversationReport(source, async () => (await request(endpoint, { body: frameworkBody })).text())).rejects.toBe(sourceError);
        expect(report.snapshot()?.entries.at(-1)).toMatchObject({
            kind: "model.response",
            data: { outcome: "read_error", raw: start, receivedBytes: payload.length, truncated: false },
        });
    });
});

it("honors downstream cancellation and avoids pulling a disabled capture", async () => {
    let pulls = 0;
    let cancelled: unknown;
    const response = new Response(
        new ReadableStream(
            {
                pull(controller) {
                    pulls++;
                    controller.enqueue(new Uint8Array([65]));
                },
                cancel(reason) {
                    cancelled = reason;
                },
            },
            { highWaterMark: 0 },
        ),
    );
    const request = observeModelReportRequest(observeModelReportTransport(async () => response));
    expect(await withModelConversationReport(source, () => request(endpoint))).toBe(response);
    expect(pulls).toBe(0);

    const report = new ConversationReportRecorder();
    await withConversationReport(report.start(target, "turn-3"), async () => {
        await withModelConversationReport(source, async () => {
            const reader = (await request(endpoint)).body!.getReader();
            expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([65]) });
            await reader.cancel("consumer stopped");
        });
        expect(pulls).toBe(1);
        expect(cancelled).toBe("consumer stopped");
        expect(report.snapshot()?.entries.at(-1)).toMatchObject({ kind: "model.response", data: { outcome: "cancelled", raw: "A" } });
    });
});

it("attaches an HTTP failure body to the actual chat request report", async () => {
    const report = new ConversationReportRecorder();
    const raw = '{"error":{"message":"model is overloaded"}}';
    const model = new ChatModel(
        stubCtx(),
        () => ({ baseURL: "https://provider.example/v1/", apiKey: "not-for-the-report", model: "test-model" }),
        { modelId: "test-model", providerName: "test-provider", abilities: [ModelAbility.Chat] },
        observeModelReportTransport(async () => new Response(raw, { status: 503, headers: { "content-type": "application/json" } })),
        loggingStub(),
    );
    await withConversationReport(report.start(target, "turn-4"), async () => {
        await expect(model.chat({ messages: [{ role: "system", content: "actual system prompt" }], stream: false })).rejects.toMatchObject({
            context: { httpStatus: 503 },
        });
        const entries = report.snapshot()?.entries;
        expect(entries).toMatchObject([
            {
                kind: "model.request",
                data: { provider: "test-provider", model: "test-model", payload: { messages: [{ role: "system", content: "actual system prompt" }] } },
            },
            { kind: "model.response", data: { outcome: "complete", status: 503, raw } },
        ]);
        expect(entries?.[0].data).toHaveProperty("requestId", expect.stringMatching(/^chat-/));
        expect(JSON.stringify(entries)).not.toContain("not-for-the-report");
    });
});
