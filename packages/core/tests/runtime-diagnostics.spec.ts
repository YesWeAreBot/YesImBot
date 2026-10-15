import { expect, it } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { ModelService } from "../src/model/service";
function service(providers: any[], groups: any[], task: any) {
    const s: any = Object.create(ModelService.prototype);
    const logs: string[] = [];
    Object.assign(s, { config: { providers, modelGroups: groups, task } });
    Object.defineProperty(s, "logger", { value: { warn: (m: string) => logs.push(m) } });
    Object.defineProperty(s, "ctx", { value: { scope: { update() {} } } });
    return { s, logs };
}
it("missing embedding assignment is left unset without an embedding provider", () => {
    const { s, logs } = service(
        [{ name: "DS", type: "DeepSeek", models: [{ modelId: "chat", abilities: [ModelAbility.Chat] }] }],
        [{ name: "chat", models: [{ providerName: "DS", modelId: "chat" }] }],
        { chat: "chat" },
    );
    s.validateConfig();
    expect(s.config.task.embed).toBeUndefined();
    expect(logs.join("\n")).toContain("嵌入");
});
it("embedding fallback selects a capable group instead of the first chat group", () => {
    const { s } = service(
        [
            {
                name: "OAI",
                type: "OpenAI",
                models: [
                    { modelId: "chat", abilities: [ModelAbility.Chat] },
                    { modelId: "embed", abilities: [ModelAbility.Embedding] },
                ],
            },
        ],
        [
            { name: "chat", models: [{ providerName: "OAI", modelId: "chat" }] },
            { name: "embedding", models: [{ providerName: "OAI", modelId: "embed" }] },
        ],
        { chat: "chat" },
    );
    s.validateConfig();
    expect(s.config.task.embed).toBe("embedding");
});
it("caller cancellation is propagated without reporting a model timeout", async () => {
    const m: any = Object.create(ChatModel.prototype),
        logs: string[] = [];
    const controller = new AbortController(),
        reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    Object.assign(m, {
        config: { modelId: "test", parameters: { stream: false } },
        buildChatOptions: (o: any) => o,
        _executeNonStream: async () => {
            throw reason;
        },
    });
    Object.defineProperty(m, "logger", { value: { debug: (s: string) => logs.push(s), info() {}, error: (s: string) => logs.push(s) } });
    await expect(m.chat({ messages: [], abortSignal: controller.signal, stream: false })).rejects.toBe(reason);
    expect(logs.join("\n")).not.toContain("请求超时");
});
it("decision journal closes even if reply-control persistence fails during stop", async () => {
    const core: any = Object.create(AgentCore.prototype);
    let closed = false;
    Object.assign(core, {
        pendingAssessments: new Map(),
        activeTurns: new Map(),
        activeDecisionIds: new Map(),
        topics: { dispose() {} },
        scheduler: { dispose() {} },
        willing: { stopDecayCycle() {} },
        replyControl: {
            flush: async () => {
                throw new Error("disk");
            },
        },
        decisionJournal: {
            close: async () => {
                closed = true;
            },
        },
    });
    await expect(core.stop()).rejects.toThrow("disk");
    expect(closed).toBe(true);
});

it("request purpose stays local and cannot enter the provider request parameters", () => {
    const m: any = Object.create(ChatModel.prototype);
    Object.assign(m, {
        config: { modelId: "test", parameters: {} },
        chatProvider: () => ({ model: "test" }),
        customParameters: {},
        fetch: async () => new Response("{}"),
    });
    const options = m.buildChatOptions({ messages: [], requestPurpose: "话题分析" });
    expect(options.requestPurpose).toBeUndefined();
});
