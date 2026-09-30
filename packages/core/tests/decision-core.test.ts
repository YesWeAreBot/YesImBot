import { expect, it } from "bun:test";
import { AgentCore } from "../lib/agent/agent-core";
import { DecisionRecords } from "../src/agent/decision-record";
import { ReplyControl } from "../src/agent/reply-control";
import { WillingnessManager } from "../src/agent/willing";
import { Services } from "../src/shared/constants";

function setup() {
    const target = { platform: "qq", selfId: "bot", channelId: "g", isDirect: false };
    const session: any = {
        ...target,
        cid: "qq:g",
        content: "private-text-marker",
        userId: "u",
        elements: [],
        stripped: {},
        bot: { selfId: "bot" },
        resolve: (v: any) => v,
    };
    const config: any = {
        base: { text: 12 },
        attribute: { atMention: 100, isQuote: 15, isDirectMessage: 40 },
        interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 10, probabilityAmplifier: 1, replyCost: 35 },
    };
    const core: any = Object.create(AgentCore.prototype);
    const ctx: any = { on() {}, [Services.Logger]: { getLogger: () => ({ debug() {} }) } };
    const scheduled: any[] = [];
    const decisions = new DecisionRecords();
    Object.assign(core, {
        config,
        stopped: false,
        decisions,
        pendingAssessments: new Map(),
        activeTurns: new Map(),
        willing: new WillingnessManager(ctx, config),
        scheduler: { noteUserMessage() {}, isBusy: () => false, schedule: (s: any) => scheduled.push(s) },
        worldState: { isBotMuted: () => false, peekBotMuted: () => false },
    });
    core.replyControl = new ReplyControl(
        { load: async () => [], save: async () => {}, remove: async () => {} },
        () => {},
        async () => {}
    );
    Object.defineProperty(core, "logger", { value: { debug() {}, info() {}, warn() {} } });
    Object.defineProperty(core, "ctx", { value: ctx });
    return { core, ctx, session, target, decisions, scheduled };
}

it("records the actual roll and accepted scheduling without retaining message text", () => {
    const t = setup();
    const random = Math.random;
    let draws = 0;
    Math.random = () => {
        draws++;
        return 0.2;
    };
    try {
        t.core.receiveStimulus({ type: "user_message", session: t.session });
        const record = t.decisions.latest(t.target)!;
        expect(record.stage).toBe("scheduled");
        expect(record.roll).toBe(0.2);
        expect(record.calculation?.after).toBe(12);
        expect(JSON.stringify(record)).not.toContain("private-text-marker");
        expect(t.core.queryDecision(t.session)).toContain("0.2");
        expect(draws).toBe(1);
        expect(t.scheduled).toHaveLength(1);
    } finally {
        Math.random = random;
    }
});

it("keeps observe-mode semantic results while applying the original gain", async () => {
    const t = setup();
    let evaluations = 0;
    t.core.config.typesafe = {
        mode: "observe",
        evaluationModel: { providerName: "test", modelId: "test" },
        timeoutMs: 1000,
        historyLimit: 0,
        interests: "test",
        influence: 0.5,
    };
    t.session.toJSON = () => ({ message: { content: t.session.content } });
    t.ctx[Services.Model] = {
        getEvaluationModel: () => ({
            evaluate: async () => {
                evaluations++;
                return { answers: { addressed: { noul: 1 }, interested: { noul: 0 }, others: { noul: 0 } } };
            },
        }),
    };
    t.core.receiveStimulus({ type: "user_message", session: t.session });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const record = t.decisions.latest(t.target)!;
    expect(record.assessment).toMatchObject({
        mode: "observe",
        multiplier: 1.5,
        status: "completed",
        answers: { addressed: 1, interested: 0, others: 0 },
    });
    expect(record.calculation?.assessmentMultiplier).toBe(1);
    t.core.queryDecision(t.session);
    expect(evaluations).toBe(1);
});

it("records suppression and muting without scheduling a reply", async () => {
    const t = setup();
    await t.core.replyControl.set(t.target, ["all"], 1000);
    t.core.receiveStimulus({ type: "user_message", session: t.session });
    expect(t.decisions.latest(t.target)?.reason).toBe("reply_suppressed");
    expect(t.core.willing.getCurrentWillingness(JSON.stringify(["qq", "bot", "g"]))).toBe(0);
    await t.core.replyControl.resume(t.target);
    t.core.worldState.isBotMuted = () => true;
    t.core.receiveStimulus({ type: "user_message", session: t.session });
    expect(t.decisions.latest(t.target)?.reason).toBe("muted");
    expect(t.scheduled).toHaveLength(0);
});
