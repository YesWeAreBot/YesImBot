import { describe, expect, it } from "bun:test";

import type { Message } from "@xsai/shared-chat";
import type { Context } from "koishi";

import { ChatModel, ChatRequestOptions } from "../src/services/model/chat-model";
import { ContentFailureAction, ModelAbility } from "../src/services/model/config";
import { ChatModelSwitcher } from "../src/services/model/service";
import { Services } from "../src/shared/constants";

const malformedResponse = "thoughts observe analyze_infer plan actions function params: incomplete JSON";
const validResponse = '{"thoughts":{"observe":"hello","analyze_infer":"greeting","plan":"reply"},"actions":[],"request_heartbeat":false}';

function originalMessages(): Message[] {
    return [
        { role: "system", content: "Keep the conversation context and return JSON." },
        { role: "user", content: '<quote id="message-1">Earlier greeting</quote><at id="bot"/> What was the tool result?' },
        {
            role: "assistant",
            tool_calls: [{ id: "call-1", index: 0, type: "function", function: { name: "lookup", arguments: '{"key":"hello"}' } }],
        },
        { role: "tool", tool_call_id: "call-1", content: "The result was a greeting." },
        {
            role: "user",
            content: [
                { type: "text", text: "Use that result to reply." },
                { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==", detail: "low" } },
            ],
        },
    ];
}

function streamResponse(text: string): Response {
    const chunk = {
        id: "completion-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "test",
        choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    };
    const finish = {
        ...chunk,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
    });
}

function fixture(responses: Array<string | Error>) {
    const logger = {
        extend() {
            return this;
        },
        info() {},
        warn() {},
        error() {},
        debug() {},
        success() {},
    };
    const ctx = { [Services.Logger]: { getLogger: () => logger } } as unknown as Context;
    const requests: Array<{ model: string; messages: Message[]; stream: boolean }> = [];
    // 仅替换外部 HTTP 响应；真实 ChatModel 负责流式内容验证和错误分类。
    const fetch = (async (_url, init) => {
        requests.push(JSON.parse(init!.body as string));
        const response = responses.shift();
        if (response === undefined) throw new Error("Unexpected model request");
        if (response instanceof Error) throw response;
        return streamResponse(response);
    }) as typeof globalThis.fetch;
    const models = ["primary", "fallback"].map(
        (modelId) =>
            new ChatModel(
                ctx,
                (model) => ({ model, baseURL: "https://model.invalid/v1/", apiKey: "test-key" }),
                {
                    modelId,
                    abilities: [ModelAbility.Chat, ModelAbility.Vision],
                    parameters: { stream: true },
                    timeoutPolicy: { firstTokenTimeout: 5, totalTimeout: 10 },
                    retryPolicy: { maxRetries: modelId === "primary" ? 1 : 0, onContentFailure: ContentFailureAction.AugmentAndRetry },
                },
                fetch,
            ),
    );
    const switcher = new ChatModelSwitcher(
        ctx,
        { name: "test", models: models.map((model) => ({ providerName: "test", modelId: model.id })) },
        (_provider, modelId) => models.find((model) => model.id === modelId) ?? null,
    );
    const options: ChatRequestOptions = { messages: originalMessages(), stream: true, validation: { format: "json" } };
    return { switcher, requests, options };
}

describe("model failover message isolation", () => {
    it("repairs JSON on the current model without replacing the caller's messages", async () => {
        const { switcher, requests, options } = fixture([malformedResponse, validResponse]);
        const messages = options.messages;

        const result = await switcher.chat(options);

        expect(result.text).toBe(validResponse);
        expect(requests.map((request) => request.model)).toEqual(["primary", "primary"]);
        expect(requests[0].messages).toEqual(originalMessages());
        expect(requests[1].messages).toHaveLength(2);
        expect(requests[1].messages[0].role).toBe("system");
        expect(requests[1].messages[0].content).toContain("JSON formatter");
        expect(requests[1].messages[1]).toEqual({ role: "user", content: malformedResponse });
        expect(options.messages).toBe(messages);
        expect(options.messages).toEqual(originalMessages());
    });

    it("sends the complete original history to fallback after a repair request fails on the network", async () => {
        const { switcher, requests, options } = fixture([malformedResponse, new TypeError("fetch failed"), validResponse]);

        const result = await switcher.chat(options);

        expect(result.text).toBe(validResponse);
        expect(requests.map((request) => request.model)).toEqual(["primary", "primary", "fallback"]);
        expect(requests[1].messages[1]).toEqual({ role: "user", content: malformedResponse });
        expect(requests[2].messages).toEqual(originalMessages());
        expect(requests.every((request) => request.stream)).toBe(true);
        expect(options.messages).toEqual(originalMessages());
    });

    it("starts a later invocation with the caller's original messages after JSON repair succeeds", async () => {
        const { switcher, requests, options } = fixture([malformedResponse, validResponse, validResponse]);

        await switcher.chat(options);
        const result = await switcher.chat(options);

        expect(result.text).toBe(validResponse);
        expect(requests.map((request) => request.model)).toEqual(["primary", "primary", "primary"]);
        expect(requests[2].messages).toEqual(originalMessages());
    });
});
