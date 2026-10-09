import { expect, it } from "bun:test";

import { DecisionRecords, formatDecision } from "../src/agent/decision-record";

it("keeps the newest message visible when an older asynchronous task finishes", () => {
    const records = new DecisionRecords(3, () => 100);
    const target = { platform: "qq", selfId: "bot", channelId: "group" };
    const old = records.begin(target, "user_message");
    records.update(old, { stage: "running" });
    const newer = records.begin(target, "user_message");
    records.update(newer, { stage: "skipped", reason: "below_threshold", decision: false });
    records.update(old, { stage: "completed", success: true });
    expect(records.latest(target)?.id).toBe(newer);
    expect(records.latest(target)?.decision).toBe(false);
});

it("does not overwrite cancellation with late completion or alter results during querying", () => {
    const records = new DecisionRecords(3, () => 100);
    const target = { platform: "qq", selfId: "bot", channelId: "group" };
    const id = records.begin(target, "user_message");
    records.update(id, { stage: "cancelled", reason: "pause", roll: 0.8 });
    records.update(id, { stage: "completed", success: true });
    const before = records.latest(target)!;
    before.stage = "running";
    const originalRandom = Math.random;
    Math.random = () => {
        throw new Error("query must not draw randomness");
    };
    try {
        expect(records.latest(target)?.stage).toBe("cancelled");
        expect(
            formatDecision(records.latest(target), {
                score: 10,
                busy: false,
                assessing: false,
                muted: false,
                participation: { active: false },
            }),
        ).toContain("0.8");
    } finally {
        Math.random = originalRandom;
    }
});

it("bounds memory and separates platform, bot and conversation", () => {
    const records = new DecisionRecords(2, () => 100);
    const target = { platform: "qq", selfId: "bot", channelId: "group" };
    records.begin(target, "user_message");
    records.begin({ ...target, selfId: "other" }, "user_message");
    records.begin({ ...target, platform: "onebot" }, "user_message");
    expect(records.latest(target)).toBeUndefined();
    expect(records.latest({ ...target, selfId: "other" })).toBeDefined();
    expect(records.latest({ ...target, platform: "onebot" })).toBeDefined();
});

it("clears a previous busy reason when running and completed stages are recorded", () => {
    const records = new DecisionRecords(3, () => 100);
    const target = { platform: "qq", selfId: "bot", channelId: "group" };
    const id = records.begin(target, "user_message");
    records.update(id, { stage: "queued", reason: "busy" });
    records.update(id, { stage: "running", reason: undefined });
    expect(records.latest(target)?.reason).toBeUndefined();
    records.update(id, { stage: "completed", success: true });
    expect(records.latest(target)?.stage).toBe("completed");
    expect(records.latest(target)?.reason).toBeUndefined();
});
