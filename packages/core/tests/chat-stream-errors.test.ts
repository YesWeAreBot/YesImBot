import { expect, it } from "bun:test";
import { ChatModel } from "../src/services/model/chat-model";
import { ModelAbility } from "../src/services/model/config";
import { Services } from "../src/shared/constants";
import { AppError, ErrorDefinitions } from "../src/shared/errors";
import { ChatModelSwitcher } from "../src/services/model/service";

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const frame = (delta: any, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const usageFrame = `data: ${JSON.stringify({ choices: [], usage })}\n\n`;
const done = "data: [DONE]\n\n";

function fixture(response: () => Response | Promise<Response>) {
    const logs: string[] = [];
    const debugLogs: string[] = [];
    const logger = Object.fromEntries(
        ["debug", "info", "warn", "error", "success"].map((level) => [level, (...args: any[]) => {
            const message = args.join(" ");
            logs.push(message);
            if (level === "debug") debugLogs.push(message);
        }])
    );
    logger.extend = () => logger;
    let requests = 0;
    const model = new ChatModel(
        { [Services.Logger]: { getLogger: () => logger } } as any,
        () => ({ baseURL: "https://stream-test.invalid/v1/", apiKey: "test-secret", model: "test" }),
        { modelId: "test", providerName: "test-provider", abilities: [ModelAbility.Chat], parameters: { stream: true, custom: [] } },
        (async () => { requests++; return response(); }) as typeof fetch
    );
    return { model, logs, debugLogs, requests: () => requests };
}

function sse(body: string): Response {
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function failure(model: ChatModel): Promise<AppError> {
    try {
        await model.chat({ messages: [{ role: "user", content: "hello" }] });
    } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        return error as AppError;
    }
    throw new Error("The failed stream was incorrectly accepted as a successful response");
}

it("preserves HTTP 429 instead of reporting an empty stream", async () => {
    const { model, requests } = fixture(() => new Response(JSON.stringify({ error: { message: "local DPS limit" } }), {
        status: 429, headers: { "content-type": "application/json", "retry-after": "3" },
    }));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.RATE_LIMIT_EXCEEDED.code);
    expect(error.context?.httpStatus).toBe(429);
    expect(error.cause).toBeDefined();
    expect(requests()).toBe(1);
});

it("preserves an error received in an SSE frame", async () => {
    const { model } = fixture(() => sse(`data: ${JSON.stringify({ error: { message: "upstream overloaded" } })}\n\n${done}`));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.REQUEST_FAILED.code);
    expect(String((error.cause as Error)?.message)).toContain("upstream overloaded");
});

it("preserves malformed SSE JSON as a parsing or transport failure", async () => {
    const { model } = fixture(() => sse("data: {bad-json}\n\n"));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.REQUEST_FAILED.code);
    expect(error.cause).toBeDefined();
});

it("reports an unterminated SSE data line as a protocol failure rather than empty content", async () => {
    const { model } = fixture(() => sse('data: {"choices":[{"delta":{"content":"lost reply"}}]}'));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.REQUEST_FAILED.code);
    expect(error.context.streamDiagnostics.pendingLineChars).toBeGreaterThan(0);
});

it("does not accept partial text followed by an SSE error", async () => {
    const { model } = fixture(() => sse(frame({ content: "partial reply" }) +
        `data: ${JSON.stringify({ error: { message: "stream interrupted" } })}\n\n`));
    const error = await failure(model);
    expect(error.code).not.toBe(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT.code);
    expect(String((error.cause as Error)?.message)).toContain("stream interrupted");
});

it("preserves a rejected fetch instead of reporting empty content", async () => {
    const { model } = fixture(async () => { throw new Error("fetch failed"); });
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.NETWORK.REQUEST_FAILED.code);
    expect((error.cause as Error)?.message).toBe("fetch failed");
});

it("rejects an SDK refusal error event even after receiving text", async () => {
    const { model } = fixture(() => sse(frame({ content: "partial reply" }) + frame({ refusal: "upstream refused" }) + done));
    const error = await failure(model);
    expect(error.code).not.toBe(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT.code);
    expect([error.message, (error.cause as Error)?.message].join("\n")).toContain("upstream refused");
});

it("keeps normal SSE text, usage, and first-content notification", async () => {
    const { model } = fixture(() => sse(frame({ content: "hello" }) + frame({}, "stop") + usageFrame + done));
    let starts = 0;
    const result = await model.chat({ messages: [{ role: "user", content: "hi" }], onStreamStart: () => { starts++; } });
    expect(result.text).toBe("hello");
    expect(result.usage).toEqual(usage);
    expect(result.finishReason).toBe("stop");
    expect(starts).toBe(1);
});

it("keeps a normal tool-only SSE response", async () => {
    const { model } = fixture(() => sse(frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: '{"id":1}' } }] }) + frame({}, "tool_calls") + usageFrame + done));
    const result = await model.chat({ messages: [{ role: "user", content: "hi" }], tools: [{
        type: "function", function: { name: "lookup", description: "test", parameters: { type: "object" } },
        execute: async () => "stub result",
    }] });
    expect(result.text).toBe("");
    expect(result.toolCalls?.[0]?.toolName).toBe("lookup");
    expect(result.toolCalls?.[0]?.args).toBe('{"id":1}');
    expect(result.usage).toEqual(usage);
});

it("waits through a paused stream and accepts resumed output without another request", async () => {
    const encoder = new TextEncoder();
    const { model, requests } = fixture(() => new Response(new ReadableStream({
        async start(controller) {
            controller.enqueue(encoder.encode(frame({ content: "hello" })));
            await new Promise((resolve) => setTimeout(resolve, 30));
            controller.enqueue(encoder.encode(frame({ content: " world" }) + frame({}, "stop") + usageFrame + done));
            controller.close();
        },
    }), { headers: { "content-type": "text/event-stream" } }));
    const result = await model.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("hello world");
    expect(result.usage).toEqual(usage);
    expect(requests()).toBe(1);
});

it("reports token usage in diagnostics for reasoning-only empty output", async () => {
    const { model, logs } = fixture(() => sse(frame({ reasoning_content: "thinking" }) + frame({}, "stop") + usageFrame + done));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT.code);
    const diagnostics = logs.join("\n");
    expect(diagnostics).toMatch(/(?:prompt_tokens|输入)[^\n]*10/);
    expect(diagnostics).toMatch(/(?:completion_tokens|输出)[^\n]*5/);
});

it("clearly rejects a JSON response to a streaming request", async () => {
    const { model, logs } = fixture(() => new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage,
    }), { headers: { "content-type": "application/json" } }));
    const error = await failure(model);
    expect(error.code).not.toBe(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT.code);
    expect([error.message, (error.cause as Error)?.message, JSON.stringify(error.context), ...logs].join("\n"))
        .toMatch(/content.?type|SSE|text\/event-stream/i);
});

it("keeps input, output, reasoning, API key, and usage extensions out of DEBUG diagnostics", async () => {
    const input = "private-input-marker";
    const output = "private-output-marker";
    const reasoning = "private-reasoning-marker";
    const usageExtension = "private-usage-extension-marker";
    const { model, debugLogs } = fixture(() => sse(frame({ reasoning_content: reasoning }) + frame({ content: output }) +
        frame({}, "stop") + `data: ${JSON.stringify({ choices: [], usage: { ...usage, secret: usageExtension } })}\n\n` + done));
    const result = await model.chat({ messages: [{ role: "user", content: input }] });
    expect(result.text).toBe(output);
    const diagnostics = debugLogs.join("\n");
    for (const secret of [input, output, reasoning, "test-secret", usageExtension]) expect(diagnostics).not.toContain(secret);
    expect(diagnostics).toContain("prompt_tokens");
});

it("counts split SSE frames and UTF-8 characters without duplicating or corrupting content", async () => {
    const bytes = new TextEncoder().encode(frame({ reasoning_content: "思考" }) + frame({ content: "你好" }) +
        frame({}, "stop") + usageFrame + done);
    const { model, debugLogs } = fixture(() => new Response(new ReadableStream({
        start(controller) {
            // One-byte chunks split both the data prefix and every multibyte UTF-8 character.
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
        },
    }), { headers: { "content-type": "text/event-stream" } }));
    const result = await model.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("你好");
    expect(result.usage).toEqual(usage);
    const diagnostics = debugLogs.join("\n");
    expect(diagnostics).toMatch(/"contentChars":2/);
    expect(diagnostics).toMatch(/"reasoningChars":2/);
    expect(diagnostics).toMatch(/"frames":5/);
});

it("discards partial content when the response body aborts and preserves TIMEOUT", async () => {
    const encoder = new TextEncoder();
    const { model, requests } = fixture(() => new Response(new ReadableStream({
        async start(controller) {
            controller.enqueue(encoder.encode(frame({ content: "partial must not succeed" })));
            await new Promise((resolve) => setTimeout(resolve, 5));
            controller.error(new DOMException("request timed out", "AbortError"));
        },
    }), { headers: { "content-type": "text/event-stream" } }));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.TIMEOUT.code);
    expect((error.cause as Error)?.name).toBe("AbortError");
    expect(error.context?.rawResponse).toBeUndefined();
    expect(requests()).toBe(1);
});

it("rejects complete content frames followed by EOF without a completion signal", async () => {
    const { model } = fixture(() => sse(frame({ content: "partial reply" })));
    const error = await failure(model);
    expect(error.code).toBe(ErrorDefinitions.LLM.REQUEST_FAILED.code);
    expect(error.message).toMatch(/EOF|完成|终止/);
});

it("accepts an unnewline-terminated DONE tail after a complete finish_reason frame", async () => {
    const { model, requests } = fixture(() => sse(frame({ content: "complete reply" }) + frame({}, "stop") + usageFrame + "data: [DONE]"));
    const result = await model.chat({ messages: [] });
    expect(result.text).toBe("complete reply");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual(usage);
    expect(requests()).toBe(1);
});

it("accepts a split DONE tail only after a complete completion signal", async () => {
    const bytes = new TextEncoder().encode(frame({ content: "你好" }) + frame({}, "stop") + "data: [DONE]");
    const { model } = fixture(() => new Response(new ReadableStream({
        start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
        },
    }), { headers: { "content-type": "text/event-stream" } }));
    expect((await model.chat({ messages: [] })).text).toBe("你好");
});

it("rejects a DONE tail at EOF when no complete completion signal preceded it", async () => {
    const { model } = fixture(() => sse(frame({ content: "partial reply" }) + "data: [DONE]"));
    expect((await failure(model)).code).toBe(ErrorDefinitions.LLM.REQUEST_FAILED.code);
});

for (const tail of ["data: [DON", "data: [DONE]garbage", 'data: {"choices":[',
    'data: {"choices":[{"delta":{"tool_calls":[']) {
    it(`rejects a truncated data tail after finish_reason: ${JSON.stringify(tail)}`, async () => {
        const { model } = fixture(() => sse(frame({ content: "reply" }) + frame({}, "stop") + tail));
        expect((await failure(model)).code).toBe(ErrorDefinitions.LLM.REQUEST_FAILED.code);
    });
}

it("does not execute an incomplete tool call followed by an unnewline-terminated DONE tail", async () => {
    let executions = 0;
    const { model } = fixture(() => sse(frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: '{"id":' } }] }) + "data: [DONE]"));
    await expect(model.chat({ messages: [], tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(0);
});

it("does not execute truncated tool arguments even with finish_reason before the DONE tail", async () => {
    let executions = 0;
    const { model } = fixture(() => sse(frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: '{"id":' } }] }) + frame({}, "tool_calls") + "data: [DONE]"));
    await expect(model.chat({ messages: [], tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(0);
});

it("does not execute a tool from a complete frame followed by abnormal EOF", async () => {
    let executions = 0;
    const { model } = fixture(() => sse(frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: '{}' } }] })));
    await expect(model.chat({ messages: [{ role: "user", content: "hi" }], tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(0);
});

for (const termination of [done, frame({}, "stop") + usageFrame, frame({}, "content_filter")]) {
    it(`accepts a supported completion signal ${JSON.stringify(termination)}`, async () => {
        const { model } = fixture(() => sse(frame({ content: "reply" }) + termination));
        expect((await model.chat({ messages: [] })).text).toBe("reply");
    });
}

it("keeps a validator-approved early exit without an upstream finish frame", async () => {
    const { model } = fixture(() => sse(frame({ content: '{"answer":1}' })));
    const result = await model.chat({ messages: [], validation: { format: "json" } });
    expect(result.text).toBe('{"answer":1}');
});

it("does not trust an upstream AbortError named early_exit without validator approval", async () => {
    const { model } = fixture(() => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(frame({ content: "partial" })));
        },
        pull(controller) { controller.error(new DOMException("early_exit", "AbortError")); },
    }), { headers: { "content-type": "text/event-stream" } }));
    expect((await failure(model)).code).toBe(ErrorDefinitions.LLM.TIMEOUT.code);
});

it("routes an abnormal EOF through the existing fallback model", async () => {
    const primary = fixture(() => sse(frame({ content: "partial" })));
    const fallback = fixture(() => sse(frame({ content: "fallback" }) + done));
    primary.model.config.modelId = "primary";
    fallback.model.config.modelId = "fallback";
    for (const f of [primary, fallback]) {
        f.model.config.retryPolicy = { maxRetries: 0 } as any;
        f.model.config.timeoutPolicy = { firstTokenTimeout: 5, totalTimeout: 5 };
    }
    const logger = { extend() { return this; }, debug() {}, info() {}, warn() {}, error() {} };
    const switcher = new ChatModelSwitcher({ [Services.Logger]: { getLogger: () => logger } } as any,
        { name: "test", models: ["primary", "fallback"].map(modelId => ({ providerName: "test", modelId })) },
        (_, id) => id === "primary" ? primary.model : fallback.model);
    expect((await switcher.chat({ messages: [] })).text).toBe("fallback");
    expect(primary.requests()).toBe(1);
    expect(fallback.requests()).toBe(1);
});

it("requires a completion signal for each response of a multi-step tool request", async () => {
    let response = 0, executions = 0;
    const tool = frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: '{}' } }] });
    const { model } = fixture(() => sse(++response === 1 ? tool + frame({}, "tool_calls") + done : tool));
    await expect(model.chat({ messages: [], maxSteps: 2, tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(1);
    expect(response).toBe(2);
});

for (const termination of [done, frame({}, "tool_calls") + usageFrame]) {
    it(`accepts a tool response terminated by ${JSON.stringify(termination)}`, async () => {
        let executions = 0;
        const { model } = fixture(() => sse(frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
            function: { name: "lookup", arguments: '{}' } }] }) + termination));
        const result = await model.chat({ messages: [], tools: [{
            type: "function", function: { name: "lookup", parameters: { type: "object" } },
            execute: async () => { executions++; return "result"; },
        }] });
        expect(executions).toBe(1);
        expect(result.toolCalls?.[0].toolName).toBe("lookup");
    });
}

it("does not let validator-approved text authorize a truncated tool response", async () => {
    let executions = 0;
    const { model } = fixture(() => sse(frame({ content: '{"answer":1}' }) +
        frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
            function: { name: "lookup", arguments: '{}' } }] })));
    await expect(model.chat({ messages: [], validation: { format: "json" }, tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(0);
});

it("preserves cancellation at EOF even after validator-approved text", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelTurn", "AbortError");
    const { model } = fixture(() => new Response(new ReadableStream({
        start(stream) { stream.enqueue(new TextEncoder().encode(frame({ content: '{"answer":1}' }))); },
        pull(stream) { controller.abort(reason); stream.close(); },
    }), { headers: { "content-type": "text/event-stream" } }));
    try {
        await model.chat({ messages: [], abortSignal: controller.signal, validation: { format: "json" } });
        throw new Error("Cancelled response succeeded");
    } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe(ErrorDefinitions.LLM.TIMEOUT.code);
        expect((error as AppError).cause).toBe(reason);
    }
});

it("accepts only the validator's own early-exit abort reason", async () => {
    const controller = new AbortController();
    (controller.signal as any).controller = controller;
    const { model } = fixture(() => sse(frame({ content: '{"answer":1}' })));
    expect((await model.chat({ messages: [], abortSignal: controller.signal, validation: { format: "json" } })).text)
        .toBe('{"answer":1}');
    expect(controller.signal.reason.message).toBe("early_exit");
});

it("does not reuse validator approval from a completed tool step for the next response EOF", async () => {
    let requests = 0, executions = 0;
    const tool = frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: '{}' } }] });
    const { model } = fixture(() => sse(++requests === 1
        ? frame({ content: '{"answer":1}' }) + tool + frame({}, "tool_calls") + done
        : frame({ content: "truncated second response" })));
    await expect(model.chat({ messages: [], maxSteps: 2, validation: { format: "json" }, tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(1);
    expect(requests).toBe(2);
});

it("does not execute an oversized tool frame after validator-approved text without termination", async () => {
    let executions = 0;
    const { model } = fixture(() => sse(frame({ content: '{"answer":1}' }) +
        frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
            function: { name: "lookup", arguments: JSON.stringify({ payload: "x".repeat(66000) }) } }] })));
    await expect(model.chat({ messages: [], validation: { format: "json" }, tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] })).rejects.toBeInstanceOf(AppError);
    expect(executions).toBe(0);
});

it("accepts finish_reason in a legitimate oversized content frame without DONE", async () => {
    const text = "x".repeat(66000);
    const { model } = fixture(() => sse(frame({ content: text }, "stop")));
    const result = await model.chat({ messages: [] });
    expect(result.text).toBe(text);
    expect(result.finishReason).toBe("stop");
});

it("keeps independently validated text after a normally completed tool step", async () => {
    let requests = 0, executions = 0;
    const { model } = fixture(() => sse(++requests === 1
        ? frame({ content: '{"answer":1}' }) + frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
            function: { name: "lookup", arguments: '{}' } }] }) + frame({}, "tool_calls") + done
        : frame({ content: '{"answer":2}' }) + frame({}, "stop") + done));
    const result = await model.chat({ messages: [], maxSteps: 2, validation: { format: "json" }, tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async () => { executions++; return "result"; },
    }] });
    expect(result.text).toBe('{"answer":2}');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].finishReason).toBe("stop");
    expect(executions).toBe(1);
});

it("accepts a legitimate oversized tool frame with finish_reason and executes once", async () => {
    let executions = 0;
    const payload = "x".repeat(66000);
    const { model } = fixture(() => sse(frame({ tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "lookup", arguments: JSON.stringify({ payload }) } }] }, "tool_calls")));
    const result = await model.chat({ messages: [], tools: [{
        type: "function", function: { name: "lookup", parameters: { type: "object" } },
        execute: async args => { expect(args.payload).toBe(payload); executions++; return "result"; },
    }] });
    expect(result.finishReason).toBe("tool_calls");
    expect(executions).toBe(1);
});
