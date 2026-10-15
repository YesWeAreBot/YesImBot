import { afterEach, expect, it, vi } from "vitest";

import { WillingnessManager } from "../src/agent/willing";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const START = 1_000_000;
afterEach(() => vi.useRealTimers());
function fixture() {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const ctx = stubCtx({}, { on() {} });
    const manager = new WillingnessManager(
        ctx as any,
        {
            base: { text: 12 },
            attribute: { atMention: 25, isQuote: 15, isDirectMessage: 40 },
            interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
            lifecycle: { maxWillingness: 100, probabilityThreshold: 99, probabilityAmplifier: 1, decayHalfLifeSeconds: 100, replyCost: 35 },
        } as any,
        loggingStub(),
    );
    const session = {
        cid: "chat",
        content: "hi",
        stripped: {},
        elements: [],
        isDirect: false,
        userId: "user",
        bot: { selfId: "bot" },
        resolve: (value: any) => value,
    } as any;
    return { manager, session };
}

for (const [elapsed, heat] of [
    [1000, 0.3],
    [15000, 0.7],
    [60000, 1],
]) {
    it(`uses actual message activity for the ${elapsed}ms decay window`, async () => {
        const { manager, session } = fixture();
        try {
            manager.shouldReply(session, "chat");
            manager.startDecayCycle();
            vi.setSystemTime(START + elapsed - 1000);
            await vi.advanceTimersByTimeAsync(1000);
            expect(manager.getCurrentWillingness("chat")).toBeCloseTo(12 * (1 - (1 - Math.pow(0.5, 1 / 100)) * heat), 10);
        } finally {
            manager.stopDecayCycle();
        }
    });
}

it("refreshes activity on a new message even when its semantic gain is zero", async () => {
    const { manager, session } = fixture();
    try {
        manager.shouldReply(session, "chat");
        vi.setSystemTime(START + 60000);
        manager.shouldReply(session, "chat", undefined, 0);
        expect(manager.getCurrentWillingness("chat")).toBe(12);
        manager.startDecayCycle();
        await vi.advanceTimersByTimeAsync(1000);
        expect(manager.getCurrentWillingness("chat")).toBeCloseTo(12 * (1 - (1 - Math.pow(0.5, 1 / 100)) * 0.3), 10);
    } finally {
        manager.stopDecayCycle();
    }
});

it("does not refresh an older topic merely because attention chooses its accumulated score", async () => {
    const { manager, session } = fixture();
    try {
        manager.shouldReply(session, "old-topic");
        vi.setSystemTime(START + 60000);
        const decision = manager.shouldReply(session, "chat", undefined, 1, {
            currentScoreKey: "new-topic",
            multiplier: 1,
            latestTopicPreference: 0,
            candidates: [
                { scoreKey: "old-topic", share: 0.8 },
                { scoreKey: "new-topic", share: 0.2 },
            ],
        });
        expect(decision.scoreKey).toBe("old-topic");
        manager.startDecayCycle();
        await vi.advanceTimersByTimeAsync(1000);
        expect(manager.getCurrentWillingness("old-topic")).toBeCloseTo(12 * Math.pow(0.5, 1 / 100), 10);
        expect(manager.getCurrentWillingness("new-topic")).toBeCloseTo(12 * (1 - (1 - Math.pow(0.5, 1 / 100)) * 0.3), 10);
    } finally {
        manager.stopDecayCycle();
    }
});
