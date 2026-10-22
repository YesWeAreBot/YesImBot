import { expect, it } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { DecisionRecords } from "../src/agent/decision-record";
import { ReplyControl } from "../src/agent/reply-control";
import { WillingnessManager } from "../src/agent/willing";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

function setup() {
    const logs: string[] = [];
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
    const logger = { debug() {} };
    const ctx = stubCtx({ logging: { getLogger: () => logger } }, { on() {} });
    const scheduled: any[] = [];
    const decisions = new DecisionRecords();
    Object.assign(core, {
        config,
        stopped: false,
        decisions,
        pendingAssessments: new Map(),
        activeTurns: new Map(),
        willing: new WillingnessManager(ctx, config, loggingStub(logger)),
        scheduler: { noteUserMessage() {}, isBusy: () => false, schedule: (s: any) => scheduled.push(s) },
        worldState: { isBotMuted: () => false, peekBotMuted: () => false },
    });
    core.replyControl = new ReplyControl(
        { load: async () => [], save: async () => {}, remove: async () => {} },
        () => {},
        async () => {},
    );
    Object.defineProperty(core, "logger", {
        value: { debug: (message: string) => logs.push(message), info: (message: string) => logs.push(message), warn: (message: string) => logs.push(message) },
    });
    Object.defineProperty(core, "ctx", { value: ctx });
    return { core, ctx, session, target, decisions, scheduled, logs };
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

it.each(["observe", "adjust"] as const)("records semantic results and applies the correct gain in %s mode", async (mode) => {
    const t = setup();
    let evaluations = 0;
    t.core.config.typesafe = {
        mode,
        evaluationModel: { providerName: "test", modelId: "test" },
        timeoutMs: 1000,
        historyLimit: 0,
        interests: "test",
        influence: 0.5,
    };
    t.session.toJSON = () => ({ message: { content: t.session.content } });
    // 构造注入后 AgentCore 通过 this.modelService 取接话评估模型，不再读取 ctx 上的服务。
    Object.assign(t.core, {
        modelService: {
            getEvaluationModel: () => ({
                evaluate: async () => {
                    evaluations++;
                    return { answers: { addressed: { noul: 1 }, interested: { noul: 0 }, others: { noul: 0 } } };
                },
            }),
        },
    });
    t.core.receiveStimulus({ type: "user_message", session: t.session });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const record = t.decisions.latest(t.target)!;
    expect(record.assessment).toMatchObject({
        mode,
        multiplier: 1.5,
        status: "completed",
        answers: { addressed: 1, interested: 0, others: 0 },
    });
    expect(record.calculation?.assessmentMultiplier).toBe(mode === "adjust" ? 1.5 : 1);
    expect(record.calculation?.after).toBe(mode === "adjust" ? 18 : 12);
    t.core.queryDecision(t.session);
    expect(evaluations).toBe(1);
    expect(t.logs.join("\n")).toContain(mode === "adjust" ? "实际应用: 1.500" : "实际应用: 1.000");
    expect(t.logs.join("\n")).toContain(mode);
});

it("explains direct-message bypass without starting a semantic request", () => {
    const t = setup();
    t.session.isDirect = true;
    t.core.config.typesafe = { mode: "adjust", evaluationModel: { providerName: "p", modelId: "m" } };
    t.core.receiveStimulus({ type: "user_message", session: t.session });
    expect(t.logs.join("\n")).toContain("私聊");
    expect(t.decisions.latest({ ...t.target, isDirect: true })?.assessment?.status).toBe("bypassed");
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

it("separates Telegram topic decisions, scheduler keys, willingness and mute checks by guild", () => {
    const f = setup();
    const muted: string[] = [];
    f.core.worldState.isBotMuted = (cid: string) => {
        muted.push(cid);
        return false;
    };
    const a = { ...f.session, platform: "telegram", channelId: "7", guildId: "-10001", cid: "telegram:7" };
    const b = { ...a, guildId: "-10002" };
    const random = Math.random;
    Math.random = () => 0;
    try {
        f.core.receiveStimulus({ type: "user_message", session: a });
        f.core.receiveStimulus({ type: "user_message", session: b });
        const first = f.decisions.latest(a)!,
            second = f.decisions.latest(b)!;
        expect(first.id).not.toBe(second.id);
        expect(first.target.guildId).toBe("-10001");
        expect(second.calculation?.before).toBe(0);
        expect(first.key).not.toBe(second.key);
        expect(f.scheduled.map((s) => s.channelCid)).toEqual([first.key, second.key]);
        expect(new Set(muted)).toEqual(new Set(['telegram:telegram-topic:["-10001","7"]', 'telegram:telegram-topic:["-10002","7"]']));
        expect(a.channelId).toBe("7");
    } finally {
        Math.random = random;
    }
});
