import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { AgentBehaviorConfigSchema } from "../src/agent/config";
import { TopicManager } from "../src/agent/topics";
import { ModelConfigSchema } from "../src/model/config";
import { loggingStub } from "./helpers/yesimbot";

test("context settings expose one collapsible section", () => {
    const context = ModelConfigSchema.dict!.contextLimit;
    assert.equal(context.meta.collapse, true);
});

test("custom context settings expose a primitive input", () => {
    const context = ModelConfigSchema.dict!.contextLimit;
    const branch = context.list![1].list!.find((item) => item.dict?.mode.value === "custom")!;
    assert.equal(branch.dict!.value.type, "string");
    assert.equal(branch.dict!.value.meta.required, true);
});

test("context schema preserves custom values and validates the declared capacity", () => {
    assert.equal(ModelConfigSchema({ modelId: "m" }).contextLimit?.mode, "unset");
    for (const value of ["131072.5", "128K", "1m", " .5 k "]) {
        assert.equal(ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value } }).contextLimit?.value, value);
    }
    for (const value of ["0", "-1", "NaN", "Infinity", "1G", "9007199254740992", "1".repeat(4097)]) {
        assert.throws(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom", value } }));
    }
    assert.throws(() => ModelConfigSchema({ modelId: "m", contextLimit: { mode: "custom" } }));
    for (const mode of ["unset", "auto"]) {
        assert.equal(ModelConfigSchema({ modelId: "m", contextLimit: { mode } }).contextLimit?.mode, mode);
    }
});

test("history settings accept counts above thirty and retain natural-number validation", () => {
    const config = AgentBehaviorConfigSchema({ topics: { historyLimit: 125 }, typesafe: { historyLimit: 100 } });
    assert.equal(config.topics?.historyLimit, 125);
    assert.equal(config.typesafe?.historyLimit, 100);
    assert.equal(AgentBehaviorConfigSchema({ typesafe: { historyLimit: 0 } }).typesafe?.historyLimit, 0);
    for (const name of ["topics", "typesafe"]) {
        for (const historyLimit of [-1, 1.5, NaN, Infinity]) {
            assert.throws(() => AgentBehaviorConfigSchema({ [name]: { historyLimit } }));
        }
    }
});

test("topic requests use the selected history count above thirty", async () => {
    const get = vi.fn<(table: unknown, query: unknown, modifier: { limit: number }) => Promise<Array<{ id: string; sender: { id: string }; content: string }>>>(
        async () => Array.from({ length: 60 }, (_, i) => ({ id: String(i), sender: { id: "u" }, content: "hi" })),
    );
    const chat = vi.fn<(request: { messages: Array<{ content: string }> }) => Promise<{ text: string }>>(async () => ({
        text: '{"topics":[],"currentTopicId":null}',
    }));
    const manager = new TopicManager(
        { database: { get } } as any,
        {
            enabled: true,
            model: { providerName: "p", modelId: "m" },
            minIntervalMs: 0,
            messagesPerAnalysis: 1,
            historyLimit: 50,
            timeoutMs: 100,
            maxTopics: 4,
            idleTimeoutSeconds: 60,
            influence: 0.5,
        },
        { logging: loggingStub(), model: { getChatModel: () => ({ chat }) } as any },
    );
    try {
        await manager.assess(
            {
                messageId: "current",
                platform: "test",
                selfId: "bot",
                channelId: "group",
                userId: "u",
                content: "hi",
                timestamp: Date.now(),
                bot: { selfId: "bot" },
            } as any,
            "test:group",
            new AbortController().signal,
        );
        assert.equal(get.mock.calls[0][2].limit, 51);
        const request = chat.mock.calls[0][0];
        assert.equal(JSON.parse(request.messages[1].content).recentMessages.length, 50);
    } finally {
        manager.dispose();
    }
});
