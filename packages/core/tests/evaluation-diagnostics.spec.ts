import { expect, it, vi } from "vitest";

import { TopicManager } from "../src/agent/topics";
import { TypeSafeEvaluator } from "../src/agent/typesafe";
import { WillingnessManager } from "../src/agent/willing";
import { Services } from "../src/shared/constants";

function fixture() {
    const logs: string[] = [];
    const logger = Object.fromEntries(["debug", "info", "warn"].map((level) => [level, (message: string) => logs.push(message)]));
    const ctx: any = { [Services.Logger]: { getLogger: () => logger } };
    const session: any = {
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        userId: "user",
        messageId: "message",
        bot: { selfId: "bot" },
        content: "private-conversation-marker",
        toJSON: () => ({ message: { content: "private-conversation-marker" } }),
    };
    return { ctx, session, logs };
}

it("reports TypeSafe request failures without disclosing exception payloads or conversation text", async () => {
    const f = fixture();
    f.ctx[Services.Model] = {
        getEvaluationModel: () => ({
            evaluate: async () => {
                throw new Error("secret-api-key");
            },
        }),
    };
    const evaluator = new TypeSafeEvaluator(f.ctx, {
        typesafe: {
            mode: "adjust",
            evaluationModel: { providerName: "provider", modelId: "model" },
            timeoutMs: 1000,
            historyLimit: 0,
            interests: "test",
            influence: 0.5,
        },
    } as any);
    expect(await evaluator.evaluate(f.session, new AbortController().signal)).toBeNull();
    expect(f.logs.join("\n")).toContain("请求失败");
    expect(f.logs.join("\n")).toContain("provider");
    expect(f.logs.join("\n")).not.toContain("secret-api-key");
    expect(f.logs.join("\n")).not.toContain(f.session.content);
});

it("reports rejected topic responses and returns to ordinary willingness without inventing a topic", async () => {
    const f = fixture();
    f.ctx[Services.Model] = { getChatModel: () => ({ chat: async () => ({ text: JSON.stringify({ topics: [] }) }) }) };
    const manager = new TopicManager(f.ctx, {
        enabled: true,
        model: { providerName: "provider", modelId: "model" },
        minIntervalMs: 1000,
        messagesPerAnalysis: 1,
        historyLimit: 0,
        timeoutMs: 1000,
        maxTopics: 4,
        idleTimeoutSeconds: 60,
        influence: 0.5,
    });
    try {
        expect(await manager.assess(f.session, "chat", new AbortController().signal)).toBeUndefined();
        expect(f.logs.join("\n")).toContain("结构无效");
        expect(f.logs.join("\n")).not.toContain(f.session.content);
    } finally {
        manager.dispose();
    }
});

it("explains a TypeSafe timeout even when the provider never settles", async () => {
    vi.useFakeTimers();
    try {
        const f = fixture();
        f.ctx[Services.Model] = { getEvaluationModel: () => ({ evaluate: () => new Promise(() => {}) }) };
        const evaluator = new TypeSafeEvaluator(f.ctx, {
            typesafe: {
                mode: "adjust",
                evaluationModel: { providerName: "p", modelId: "m" },
                timeoutMs: 10,
                historyLimit: 0,
                interests: "test",
                influence: 0.5,
            },
        } as any);
        const pending = evaluator.evaluate(f.session, new AbortController().signal);
        await vi.advanceTimersByTimeAsync(10);
        expect(await pending).toBeNull();
        expect(f.logs.join("\n")).toContain("超时");
    } finally {
        vi.useRealTimers();
    }
});

it("applies a valid topic interest multiplier to the actual willingness gain", async () => {
    const f = fixture();
    f.ctx.on = () => {};
    f.ctx[Services.Model] = {
        getChatModel: () => ({
            chat: async () => ({ text: JSON.stringify({ topics: [{ id: "topic", label: "兴趣话题", share: 1, interest: 1 }], currentTopicId: "topic" }) }),
        }),
    };
    const topics = new TopicManager(f.ctx, {
        enabled: true,
        model: { providerName: "p", modelId: "m" },
        minIntervalMs: 1000,
        messagesPerAnalysis: 1,
        historyLimit: 0,
        timeoutMs: 1000,
        maxTopics: 4,
        idleTimeoutSeconds: 60,
        influence: 0.5,
    });
    try {
        const topic = await topics.assess(f.session, "chat", new AbortController().signal);
        expect(topic?.multiplier).toBe(1.5);
        f.session.stripped = {};
        f.session.elements = [];
        f.session.resolve = (value: unknown) => value;
        const willingness = new WillingnessManager(f.ctx, {
            base: { text: 12 },
            attribute: { atMention: 100, isQuote: 15, isDirectMessage: 40 },
            interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
            lifecycle: { maxWillingness: 100, probabilityThreshold: 10, probabilityAmplifier: 0.04, replyCost: 35 },
        } as any);
        const result = willingness.shouldReply(f.session, "chat", undefined, 1, {
            currentScoreKey: topic!.scoreKey,
            multiplier: topic!.multiplier,
            candidates: topics.getTopics("chat"),
        });
        expect(result.calculation.effectiveGain).toBe(18);
        expect(willingness.getCurrentWillingness(topic!.scoreKey)).toBe(18);
    } finally {
        topics.dispose();
    }
});
