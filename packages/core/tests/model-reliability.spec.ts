import { afterEach, expect, it, vi } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ContentFailureAction, ModelAbility, type ModelConfig } from "../src/model/config";
import { ChatModelSwitcher } from "../src/model/service";
import { TableName } from "../src/shared/constants";
import { ArchivalMemoryManager } from "../src/world/l3-archival-memory";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const logger = { extend: () => logger, debug() {}, info() {}, warn() {}, error() {}, success() {} };
const logging = loggingStub(logger);
const ctx = stubCtx({ logging: { getLogger: () => logger } });
const input = (content = "hello") => ({ messages: [{ role: "user" as const, content }] });
const completion = (text: string) =>
    new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }), {
        headers: { "content-type": "application/json" },
    });
function model(id: string, fetch: typeof globalThis.fetch, config: Partial<ModelConfig> = {}) {
    return new ChatModel(
        ctx,
        (model) => ({ model, baseURL: "https://reliability.invalid/v1/", apiKey: "test" }),
        {
            modelId: id,
            abilities: [ModelAbility.Chat],
            parameters: { stream: false },
            timeoutPolicy: { totalTimeout: 2 },
            retryPolicy: { maxRetries: 0, onContentFailure: ContentFailureAction.FailoverToNext },
            ...config,
        },
        fetch,
        logging,
    );
}
function group(models: ChatModel[]) {
    return new ChatModelSwitcher(
        ctx,
        { name: "reliability", models: models.map((item) => ({ providerName: "test", modelId: item.id })) },
        (_provider, id) => models.find((item) => item.id === id)!,
        logging,
    );
}
function diaryFixture(models: ChatModel[]) {
    const saved: any[] = [];
    const date = new Date(2026, 9, 1, 12);
    const messages = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        platform: "test",
        channelId: "channel",
        timestamp: date,
        sender: { id: "user", name: "User" },
        content: "hello",
    }));
    const database = {
        get: async (table: string) => (table === TableName.L3Diaries ? saved : messages),
        create: async (_table: string, row: any) => {
            saved.push(row);
            return row;
        },
    };
    const switcher = group(models);
    const service = { useChatGroup: () => switcher };
    const memory = new ArchivalMemoryManager(
        stubCtx({}, { database }) as any,
        { l3_memory: { enabled: true, scheduled: false } } as any,
        { getAgentHistoryForDateRange: async () => [] } as any,
        logging,
        service as any,
    );
    memory.start();
    return { memory, saved, date, switcher };
}
afterEach(() => vi.restoreAllMocks());

it("keeps a healthy model available after a local context overflow without retrying that input", async () => {
    const primaryFetch = vi.fn<typeof globalThis.fetch>(async () => completion("primary"));
    const primary = model("primary", primaryFetch, {
        contextLimit: { mode: "custom", value: "500" },
        circuitBreakerPolicy: { failureThreshold: 1, cooldownSeconds: 60 },
        retryPolicy: { maxRetries: 1, onContentFailure: ContentFailureAction.FailoverToNext },
    });
    const attempts = vi.spyOn(primary, "chat");
    const switcher = group([primary, model("fallback", async () => completion("fallback"))]);
    expect((await switcher.chat(input("x".repeat(5000)))).text).toBe("fallback");
    expect(attempts).toHaveBeenCalledTimes(1);
    expect((await switcher.chat(input())).text).toBe("primary");
    expect(primaryFetch).toHaveBeenCalledTimes(1);
});

it("releases an oversized half-open probe so one later healthy probe can recover amid concurrent requests", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    let calls = 0;
    const primary = model(
        "primary",
        async () => {
            if (++calls === 1) throw new Error("provider unavailable");
            entered();
            await pending;
            return completion("recovered");
        },
        {
            contextLimit: { mode: "custom", value: "500" },
            circuitBreakerPolicy: { failureThreshold: 1, cooldownSeconds: 1 },
        },
    );
    const switcher = group([primary, model("fallback", async () => completion("fallback"))]);
    expect((await switcher.chat(input())).text).toBe("fallback");
    now += 1001;
    expect((await switcher.chat(input("x".repeat(5000)))).text).toBe("fallback");
    const recovering = switcher.chat(input());
    // Waiting on either result prevents a broken implementation from hanging the test.
    await Promise.race([started, recovering]);
    try {
        expect((await switcher.chat(input())).text).toBe("fallback");
        expect(calls).toBe(2);
    } finally {
        release();
    }
    expect((await recovering).text).toBe("recovered");
    expect((await switcher.chat(input())).text).toBe("recovered");
});

it.each(["", "   ", "\n"])("fails over after a non-stream completion has no usable text (%j) or tool calls", async (text) => {
    const switcher = group([model("empty", async () => completion(text)), model("valid", async () => completion("valid"))]);
    expect((await switcher.chat(input())).text).toBe("valid");
});

it("generates a real L3 diary through configured timeout, retry and healthy fallback", async () => {
    const signals: AbortSignal[] = [];
    const primary = model(
        "slow",
        async (_url, init) => {
            const signal = init!.signal!;
            signals.push(signal);
            return new Promise<Response>((_resolve, reject) => {
                signal.throwIfAborted();
                // Bounds the RED run where L3 bypasses the configured timeout.
                const timer = setTimeout(() => reject(new Error("test transport deadline")), 100);
                signal.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(timer);
                        reject(signal.reason);
                    },
                    { once: true },
                );
            });
        },
        {
            timeoutPolicy: { totalTimeout: 0.01 },
            retryPolicy: { maxRetries: 1, onContentFailure: ContentFailureAction.FailoverToNext },
        },
    );
    const { memory, saved, date } = diaryFixture([primary, model("healthy", async () => completion("A useful diary."))]);
    try {
        const diary = await memory.generateOnDemand("test", "channel", date);
        expect(diary?.content).toBe("A useful diary.");
        expect(saved).toHaveLength(1);
        expect(signals).toHaveLength(2);
        expect(signals.every((signal) => signal.aborted && signal.reason.name === "TimeoutError")).toBe(true);
    } finally {
        await memory.stop();
    }
});

it("does not write an empty L3 diary even when the model result bypasses transport validation", async () => {
    const adapter = model("stub", async () => completion("unused"));
    // A tool-only/model-adapter result can have no usable diary text.
    vi.spyOn(adapter, "chat").mockResolvedValue({ text: "   ", toolCalls: [{ toolName: "unused" }] } as any);
    const { memory, saved, date } = diaryFixture([adapter]);
    try {
        await expect(memory.generateOnDemand("test", "channel", date)).rejects.toMatchObject({ code: "LLM.OUTPUT_EMPTY_CONTENT" });
        expect(saved).toEqual([]);
    } finally {
        await memory.stop();
    }
});

it("preserves L3 lifecycle cancellation without calling a fallback or writing a diary", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const fallback = vi.fn<typeof globalThis.fetch>(async () => completion("must not be written"));
    const primary = model("pending", async (_url, init) => {
        entered();
        return new Promise<Response>((_resolve, reject) => {
            const signal = init!.signal!;
            signal.throwIfAborted();
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
    });
    const { memory, saved, date } = diaryFixture([primary, model("fallback", fallback)]);
    const diary = memory.generateOnDemand("test", "channel", date);
    const cancelled = diary.catch((error: unknown) => error);
    await started;
    await memory.stop();
    expect(await cancelled).toMatchObject({ message: "日记任务已取消" });
    expect(fallback).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
});

it("accepts a non-stream single-step tool call without text", async () => {
    const toolModel = model(
        "tools",
        async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: null,
                                tool_calls: [
                                    {
                                        id: "call-1",
                                        type: "function",
                                        function: { name: "lookup", arguments: "{}" },
                                    },
                                ],
                            },
                            finish_reason: "tool_calls",
                        },
                    ],
                }),
                { headers: { "content-type": "application/json" } },
            ),
    );
    const result = await toolModel.chat({
        ...input(),
        singleStep: true,
        maxSteps: 1,
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } }, execute: () => ({}) }],
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("lookup");
});
