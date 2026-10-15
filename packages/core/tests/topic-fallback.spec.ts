import { afterEach, expect, it, vi } from "vitest";

import { TopicManager } from "../src/agent/topics";
import { Services } from "../src/shared/constants";

afterEach(() => vi.useRealTimers());

const result = (id: string) => ({ text: JSON.stringify({ topics: [{ id, label: id, share: 1, interest: 0.5 }], currentTopicId: id }) });
const session = (id: string) =>
    ({ messageId: id, platform: "onebot", selfId: "bot", channelId: "group", userId: "user", content: id, bot: { selfId: "bot" } }) as any;
function fixture() {
    vi.useFakeTimers();
    const requests: Array<{ resolve(value: any): void; signal: AbortSignal }> = [];
    const reset: string[] = [];
    const ctx = {
        [Services.Logger]: { getLogger: () => ({ debug() {} }) },
        [Services.Model]: {
            getChatModel: () => ({
                chat: (options: any) =>
                    new Promise((resolve) => {
                        requests.push({ resolve, signal: options.abortSignal });
                    }),
            }),
        },
    };
    const manager = new TopicManager(
        ctx as any,
        {
            enabled: true,
            model: { providerName: "p", modelId: "m" },
            minIntervalMs: 100,
            messagesPerAnalysis: 1,
            historyLimit: 0,
            timeoutMs: 50,
            maxTopics: 4,
            idleTimeoutSeconds: 1,
            influence: 0.5,
        },
        undefined,
        (key) => reset.push(key),
    );
    return { manager, requests, reset };
}

it("falls back at the topic deadline even when the model ignores cancellation and never settles", async () => {
    const f = fixture();
    try {
        const pending = f.manager.assess(session("first"), "chat", new AbortController().signal);
        await vi.advanceTimersByTimeAsync(50);
        expect(await pending).toBeUndefined();
        expect(f.requests[0].signal.aborted).toBe(true);
        expect(f.manager.getCurrent("chat")).toBeUndefined();
        expect(await f.manager.assess(session("next"), "chat", new AbortController().signal)).toBeUndefined();
        expect(f.requests).toHaveLength(1);
    } finally {
        f.manager.dispose();
    }
});

it("does not revive timed-out topic data after a later analysis completes", async () => {
    const f = fixture();
    try {
        const first = f.manager.assess(session("first"), "chat", new AbortController().signal);
        await vi.advanceTimersByTimeAsync(100);
        await first;
        const second = f.manager.assess(session("second"), "chat", new AbortController().signal);
        f.requests[1].resolve(result("new"));
        expect((await second)?.id).toBe("new");
        f.requests[0].resolve(result("stale"));
        await vi.advanceTimersByTimeAsync(0);
        expect(f.manager.getCurrent("chat")?.id).toBe("new");
    } finally {
        f.manager.dispose();
    }
});

it("ends idle topics once and resets their willingness ownership without another model request", async () => {
    const f = fixture();
    try {
        const pending = f.manager.assess(session("first"), "chat", new AbortController().signal);
        f.requests[0].resolve(result("topic"));
        await pending;
        await vi.advanceTimersByTimeAsync(1000);
        expect(f.manager.getCurrent("chat")).toBeUndefined();
        expect(f.manager.getTopics("chat")).toEqual([]);
        expect(f.reset).toEqual(["chat"]);
        expect(f.requests).toHaveLength(1);
    } finally {
        f.manager.dispose();
    }
});
