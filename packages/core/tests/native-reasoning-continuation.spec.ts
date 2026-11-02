import { expect, it } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const frame = (delta: any, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
function fixture(body: string | (() => string), contentType = "text/event-stream", status = 200) {
    const logs: string[] = [];
    const requests: any[] = [];
    const logger: any = Object.fromEntries(
        ["debug", "info", "warn", "error", "success"].map((key) => [key, (...args: unknown[]) => logs.push(args.join(" "))]),
    );
    logger.extend = () => logger;
    const model = new ChatModel(
        stubCtx({ logging: { getLogger: () => logger } }),
        () => ({ baseURL: "https://test.invalid/v1/", apiKey: "test", model: "test" }),
        { modelId: "test", providerName: "test", abilities: [ModelAbility.Chat], parameters: { stream: true, custom: [] } },
        (async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return new Response(typeof body === "function" ? body() : body, { status, headers: { "content-type": contentType } });
        }) as typeof fetch,
        loggingStub(logger),
    );
    return { model, logs, requests };
}
const options = {
    messages: [{ role: "user", content: "hello" }] as any,
    tools: [{ type: "function", function: { name: "lookup", description: "lookup", parameters: { type: "object" } }, execute: () => ({}) }] as any,
    toolChoice: "required" as const,
    maxSteps: 1,
    singleStep: true,
};
it("preserves native reasoning only on the matching completed assistant tool message", async () => {
    const { model, logs, requests } = fixture(
        frame({ reasoning_content: "PRIVATE_REASONING_" }) +
            frame({ reasoning_content: "CONTINUATION" }) +
            frame({ tool_calls: [{ index: 0, id: "opaque:call", type: "function", function: { name: "lookup", arguments: '{"action":' } }] }) +
            frame({ tool_calls: [{ index: 0, function: { arguments: '"read"}' } }] }) +
            frame({}, "tool_calls") +
            "data: [DONE]\n\n",
    );
    const result = await model.chat(options);
    expect(requests[0].tool_choice).toBe("required");
    expect(requests[0].tools).toMatchObject([{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }]);
    const assistant = result.messages.find((message) => message.role === "assistant") as any;
    expect(assistant?.reasoning_content).toBe("PRIVATE_REASONING_CONTINUATION");
    expect(assistant?.tool_calls.map((call) => call.id)).toEqual(result.toolCalls.map((call) => call.toolCallId));
    expect(assistant?.tool_calls[0].function.arguments).toBe('{"action":"read"}');
    expect(result.text).toBe("");
    expect(logs.join("\n")).not.toContain("PRIVATE_REASONING_");
});
it("does not expose reasoning as a successful continuation when the stream is truncated", async () => {
    const { model } = fixture(
        frame({ reasoning_content: "PRIVATE" }) +
            frame({ tool_calls: [{ index: 0, id: "call", type: "function", function: { name: "lookup", arguments: "{}" } }] }),
    );
    await expect(model.chat(options)).rejects.toMatchObject({ code: "LLM.REQUEST_FAILED" });
});

it("keeps reasoning scoped to the completed tool step across multiple responses", async () => {
    let requests = 0;
    const { model } = fixture(() => {
        requests++;
        if (requests > 2) return frame({ content: "finished" }) + frame({}, "stop") + "data: [DONE]\n\n";
        return (
            frame({ reasoning_content: `step-${requests}` }) +
            frame({ tool_calls: [{ index: 0, id: `call-${requests}`, type: "function", function: { name: "lookup", arguments: "{}" } }] }) +
            frame({}, "tool_calls") +
            "data: [DONE]\n\n"
        );
    });
    const result = await model.chat({ ...options, maxSteps: 3, singleStep: false });
    expect(requests).toBe(3);
    const assistants = result.messages.filter((message) => message.role === "assistant") as any[];
    expect(assistants.map((message) => message.reasoning_content)).toEqual(["step-1", "step-2"]);
    expect(assistants.map((message) => message.tool_calls.map((call) => call.id))).toEqual([["call-1"], ["call-2"]]);
});

it("does not associate reasoning with an ambiguous call ID reused by multiple steps", async () => {
    let requests = 0;
    const { model } = fixture(() => {
        requests++;
        if (requests > 2) return frame({ content: "finished" }) + frame({}, "stop") + "data: [DONE]\n\n";
        return (
            frame({ reasoning_content: `step-${requests}` }) +
            frame({ tool_calls: [{ index: 0, id: "reused", type: "function", function: { name: "lookup", arguments: JSON.stringify({ step: requests }) } }] }) +
            frame({}, "tool_calls") +
            "data: [DONE]\n\n"
        );
    });
    const result = await model.chat({ ...options, maxSteps: 3, singleStep: false });
    expect(result.toolCalls).toHaveLength(2);
    expect(result.messages).toEqual([]);
});
it("preserves assistant content sharing a tool delta without using it as validated response text", async () => {
    const { model } = fixture(
        frame({
            content: "native-preface",
            reasoning_content: "reason",
            tool_calls: [{ index: 0, id: "call", type: "function", function: { name: "lookup", arguments: "{}" } }],
        }) +
            frame({}, "tool_calls") +
            "data: [DONE]\n\n",
    );
    const result = await model.chat(options);
    expect(result.messages[0].content).toBe("native-preface");
    expect(result.text).toBe("");
});

it("retains the original assistant reasoning when non-stream single-step completion stops the SDK", async () => {
    let requests = 0;
    const { model } = fixture(() => {
        requests++;
        return JSON.stringify({
            choices: [
                {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                        role: "assistant",
                        content: null,
                        reasoning_content: "nonstream-reason",
                        tool_calls: [{ index: 0, id: "nonstream:call", type: "function", function: { name: "lookup", arguments: "{}" } }],
                    },
                },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
    }, "application/json");
    const result = await model.chat({ ...options, stream: false });
    expect(requests).toBe(1);
    expect((result.messages[0] as any)?.reasoning_content).toBe("nonstream-reason");
    expect((result.messages[0] as any)?.tool_calls[0].id).toBe(result.toolCalls[0].toolCallId);
});

it("does not execute tools or add requests when non-stream response fails", async () => {
    let requests = 0;
    let executions = 0;
    const { model } = fixture(
        () => {
            requests++;
            return JSON.stringify({ error: { message: "rate limited" } });
        },
        "application/json",
        429,
    );
    await expect(
        model.chat({
            ...options,
            stream: false,
            tools: [
                {
                    ...options.tools[0],
                    execute: () => {
                        executions++;
                        return {};
                    },
                },
            ],
        }),
    ).rejects.toMatchObject({ code: "LLM.RATE_LIMIT_EXCEEDED" });
    expect(requests).toBe(1);
    expect(executions).toBe(0);
});
it("honors non-stream cancellation before returning captured metadata", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    let executions = 0;
    const { model } = fixture(() => {
        controller.abort(reason);
        return JSON.stringify({
            choices: [
                {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                        role: "assistant",
                        content: null,
                        reasoning_content: "reason",
                        tool_calls: [{ index: 0, id: "call", type: "function", function: { name: "lookup", arguments: "{}" } }],
                    },
                },
            ],
        });
    }, "application/json");
    await expect(
        model.chat({
            ...options,
            stream: false,
            abortSignal: controller.signal,
            tools: [
                {
                    ...options.tools[0],
                    execute: () => {
                        executions++;
                        return {};
                    },
                },
            ],
        }),
    ).rejects.toBe(reason);
    expect(executions).toBe(0);
});
