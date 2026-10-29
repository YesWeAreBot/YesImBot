import { afterEach, expect, it, vi } from "vitest";

import { AgentBehaviorConfigSchema } from "../src/agent/config";
import { WillingnessManager } from "../src/agent/willing";
import { DEFAULT_WILLINGNESS_POLICY, resolveWillingnessPolicy } from "../src/agent/willingness-policy";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const START = 1_000_000;
const topic = (key: string) => ({ currentScoreKey: key, multiplier: 1, candidates: [{ scoreKey: key, share: 1 }] });
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});
function fixture(algorithm: "legacy" | "balanced" | undefined = "balanced", overrides: Record<string, unknown> = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const config: any = {
        willingnessPolicy: { algorithm, ...overrides },
        base: { text: 12 },
        attribute: { atMention: 100, isQuote: 100, isDirectMessage: 100 },
        interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 55, probabilityAmplifier: 0.04, decayHalfLifeSeconds: 600, replyCost: 35 },
    };
    const manager = new WillingnessManager(stubCtx({}, { on() {} }), config, loggingStub());
    const session: any = {
        platform: "qq",
        channelId: "room",
        selfId: "bot",
        bot: { selfId: "bot" },
        userId: "alice",
        content: "hello",
        elements: [],
        stripped: {},
        isDirect: false,
        resolve: (value: unknown) => value,
    };
    return { config, manager, session };
}
it("keeps the legacy algorithm as the default and explicit choice", () => {
    expect(AgentBehaviorConfigSchema({}).willingnessPolicy?.algorithm).toBe("legacy");
    const old = fixture("legacy"),
        explicit = fixture("legacy");
    delete old.config.willingnessPolicy;
    for (let i = 0; i < 5; i++) {
        vi.spyOn(Math, "random").mockReturnValue(0.99);
        expect(old.manager.shouldReply(old.session, "room")).toEqual(explicit.manager.shouldReply(explicit.session, "room"));
    }
    expect(old.manager.getCurrentWillingness("room")).toBeCloseTo(76.7815, 4);
});
it("caps fast ordinary-message gain instead of amplifying a busy group", () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.manager.shouldReply(f.session, "room");
    expect(f.manager.getCurrentWillingness("room")).toBe(24);
});
it("lets clear invitations bypass the ordinary budget and opportunity interval", () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) f.manager.shouldReply(f.session, "room");
    const result = f.manager.shouldReply({ ...f.session, elements: [{ type: "at", attrs: { id: "bot" } }] }, "room");
    expect(result.probability).toBe(1);
    expect(result.calculation.policy?.invited).toBe(true);
});
it("withdraws bounded willingness from clearly other-directed messages", () => {
    const f = fixture();
    f.manager.addBackgroundWillingness(f.session, "room", 80);
    const result = f.manager.shouldReply({ ...f.session, elements: [{ type: "at", attrs: { id: "bob" } }] }, "room");
    expect(result.calculation.policy).toMatchObject({ addressesOthers: true, negativeGain: 12, positiveGain: 0 });
    expect(result.calculation.after).toBe(68);
    for (let i = 0; i < 100; i++) f.manager.shouldReply({ ...f.session, quote: { user: { id: "bob" } } }, "room");
    expect(f.manager.getCurrentWillingness("room")).toBe(56);
});
it("does not repeatedly draw during the ordinary opportunity interval", () => {
    const f = fixture();
    f.manager.addBackgroundWillingness(f.session, "room", 80);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const first = f.manager.shouldReply(f.session, "room");
    const next = f.manager.shouldReply(f.session, "room");
    expect(first.roll).toBe(0.99);
    expect(next.probability).toBe(0);
    expect(next.roll).toBeUndefined();
    expect(next.calculation.policy?.gate).toBe("opportunity_interval");
    expect(random).toHaveBeenCalledTimes(1);
});
it("uses elapsed-time decay without heat or high-score slowdown", () => {
    const f = fixture();
    f.manager.addBackgroundWillingness(f.session, "room", 80);
    vi.setSystemTime(START + 600_000);
    const result = f.manager.shouldReply(f.session, "room", undefined, 0);
    expect(result.calculation).toMatchObject({ before: 80, after: 40 });
    expect(result.calculation.policy?.decay).toBe(40);
});
it("temporarily reduces ordinary probability after a successful reply but preserves invitations", () => {
    const f = fixture("balanced", { ordinaryGainLimit: 0 });
    f.config.lifecycle.replyCost = 0;
    f.manager.addBackgroundWillingness(f.session, "room", 80);
    f.manager.handlePostReply(f.session, "room");
    const result = f.manager.shouldReply(f.session, "room");
    expect(result.calculation.policy?.fatiguePenalty).toBe(12);
    expect(result.probability).toBeCloseTo(0.52);
    expect(f.manager.shouldReply({ ...f.session, isDirect: true }, "room").probability).toBe(1);
});
it("replenishes ordinary and negative budgets gradually and resets them explicitly", () => {
    const f = fixture();
    f.manager.shouldReply(f.session, "room");
    f.manager.shouldReply(f.session, "room");
    vi.setSystemTime(START + 30_000);
    expect(f.manager.shouldReply(f.session, "room").calculation.policy?.positiveGain).toBe(12);
    const other = { ...f.session, quote: { user: { id: "bob" } } };
    f.manager.shouldReply(other, "room");
    f.manager.shouldReply(other, "room");
    expect(f.manager.shouldReply(other, "room").calculation.policy?.negativeGain).toBe(0);
    vi.setSystemTime(START + 60_000);
    expect(f.manager.shouldReply(other, "room").calculation.policy?.negativeGain).toBe(12);
    f.manager.reset("room");
    expect(f.manager.shouldReply(f.session, "room").calculation.after).toBe(12);
});
it("shares the ordinary budget across topics and transfers background credit once", () => {
    const f = fixture();
    f.manager.addBackgroundWillingness(f.session, "room", 50);
    expect(f.manager.shouldReply(f.session, "room", undefined, 1, topic("a")).calculation.after).toBe(62);
    expect(f.manager.getCurrentWillingness("room")).toBe(0);
    expect(f.manager.shouldReply(f.session, "room", undefined, 1, topic("b")).calculation.after).toBe(12);
    expect(f.manager.shouldReply(f.session, "room", undefined, 1, topic("c")).calculation.after).toBe(0);
    expect(f.manager.shouldReply(f.session, "another-room").calculation.after).toBe(12);
});
it("does not treat disabled mention categories or unknown recipients as invitations", () => {
    const f = fixture("balanced", { ordinaryGainLimit: 0 });
    const at = { ...f.session, elements: [{ type: "at", attrs: { id: "bot" } }] };
    expect(f.manager.shouldReply(at, "room", ["text"]).calculation.policy?.invited).toBe(false);
    expect(f.manager.shouldReply({ ...f.session, quote: {} }, "room").calculation.policy).toMatchObject({ invited: false, negativeGain: 0 });
    expect(f.manager.shouldReply({ ...f.session, quote: { user: { id: "bot" } } }, "room").calculation.policy?.invited).toBe(true);
});
it("reopens ordinary opportunities after the configured interval", () => {
    const f = fixture("balanced", { ordinaryGainLimit: 0 });
    f.manager.addBackgroundWillingness(f.session, "room", 80);
    f.manager.shouldReply(f.session, "room");
    vi.setSystemTime(START + 9999);
    expect(f.manager.shouldReply(f.session, "room").roll).toBeUndefined();
    vi.setSystemTime(START + 10000);
    expect(f.manager.shouldReply(f.session, "room").roll).toEqual(expect.any(Number));
});
it("decays the same amount with a running timer and lazy evaluation", () => {
    const lazy = fixture(),
        timed = fixture();
    for (const f of [lazy, timed]) f.manager.addBackgroundWillingness(f.session, "room", 80);
    timed.manager.startDecayCycle();
    vi.advanceTimersByTime(600_000);
    const a = lazy.manager.shouldReply(lazy.session, "room", undefined, 0);
    const b = timed.manager.shouldReply(timed.session, "room", undefined, 0);
    timed.manager.stopDecayCycle();
    expect(a.calculation.after).toBeCloseTo(40);
    expect(b.calculation.after).toBeCloseTo(a.calculation.after);
});
it("replays the same busy-group messages against both algorithms without assuming reply quality", () => {
    const legacy = fixture("legacy"),
        balanced = fixture();
    const counts = { legacy: 0, balanced: 0 };
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    for (let i = 0; i < 100; i++) {
        if (legacy.manager.shouldReply(legacy.session, "room").decision) counts.legacy++;
        if (balanced.manager.shouldReply(balanced.session, "room").decision) counts.balanced++;
    }
    expect(counts).toEqual({ legacy: 96, balanced: 0 });
    expect(balanced.manager.shouldReply({ ...balanced.session, isDirect: true }, "room").decision).toBe(true);
});
it("withdraws from the selected topic once when the message addresses somebody else", () => {
    const f = fixture("balanced", { ordinaryGainLimit: 0 });
    f.manager.addBackgroundWillingness(f.session, "a", 80);
    const result = f.manager.shouldReply({ ...f.session, quote: { user: { id: "bob" } } }, "room", undefined, 1, {
        currentScoreKey: "b",
        multiplier: 1,
        candidates: [
            { scoreKey: "a", share: 0.8 },
            { scoreKey: "b", share: 0.2 },
        ],
    });
    expect(result.scoreKey).toBe("a");
    expect(result.calculation.after).toBe(68);
    expect(result.calculation.policy).toMatchObject({ negativeGain: 12, negativeGainRemaining: 12 });
    expect(result.probability).toBeCloseTo(0.52);
});

it("normalizes invalid raw policy values and prevents clock rollback from refilling budgets", () => {
    expect(resolveWillingnessPolicy({ windowSeconds: NaN, ordinaryGainLimit: Infinity, replyPenalty: -1 })).toEqual(DEFAULT_WILLINGNESS_POLICY);
    const f = fixture();
    f.manager.shouldReply(f.session, "room");
    f.manager.shouldReply(f.session, "room");
    vi.setSystemTime(START - 10000);
    const result = f.manager.shouldReply(f.session, "room");
    expect(result.calculation.after).toBe(24);
    expect(result.calculation.policy?.positiveGain).toBe(0);
    expect(result.calculation.policy?.decay).toBe(0);
});
it("keeps configured continuation gain separate from ordinary quotas without duplicate topic credit", () => {
    const f = fixture("balanced", { ordinaryGainLimit: 0 });
    const first = f.manager.shouldReply(f.session, "room", undefined, 1, undefined, 35);
    expect(first.calculation).toMatchObject({ after: 35, effectiveGain: 35, continuationGain: 35 });
    f.manager.reset("room");
    const other = { ...f.session, quote: { user: { id: "bob" } } };
    const result = f.manager.shouldReply(other, "room", undefined, 1, topic("a"), 35);
    expect(result.calculation.after).toBe(23);
    expect(f.manager.getCurrentWillingness("a")).toBe(23);
});
