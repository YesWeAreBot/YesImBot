// Build the core package before running this integration test.
import { expect, it } from "bun:test";

import { AgentCore } from "../lib/agent/agent-core";
import { ReplyControl } from "../lib/agent/reply-control";
import { Services } from "../lib/shared/constants";

async function setup() {
    let now = 0;
    let release!: (value: any) => void;
    const response = new Promise((resolve) => {
        release = resolve;
    });
    const calculations: any[][] = [];
    const scheduled: any[] = [];
    const core: any = Object.create(AgentCore.prototype);
    const target = { platform: "qq", selfId: "bot", channelId: "group" };
    const key = '["qq","bot","group"]';
    Object.assign(core, {
        stopped: false,
        pendingAssessments: new Map(),
        config: {
            typesafe: {
                mode: "adjust",
                evaluationModel: { providerName: "test", modelId: "test" },
                interests: "test",
                historyLimit: 0,
                timeoutMs: 1000,
                influence: 0.5,
            },
        },
        willing: {
            reset() {},
            getCurrentWillingness: () => 0,
            shouldReply: (...args: any[]) => {
                calculations.push(args);
                return { decision: true, probability: 1 };
            },
        },
        scheduler: { noteUserMessage() {}, isBusy: () => false, cancel() {}, schedule: (stimulus: any) => scheduled.push(stimulus) },
        worldState: { isBotMuted: () => false },
    });
    Object.defineProperty(core, "ctx", { value: { [Services.Model]: { getEvaluationModel: () => ({ evaluate: async () => response }) } } });
    Object.defineProperty(core, "logger", { value: { debug() {}, info() {}, warn() {} } });
    core.replyControl = new ReplyControl(
        { load: async () => [], save: async () => {}, remove: async () => {} },
        () => core.cancelAssessment(key, false),
        async () => {},
        () => now,
    );
    await core.replyControl.set(target, ["at", "quote", "direct", "system", "scheduled", "background"], 100);
    const session: any = {
        ...target,
        bot: { selfId: "bot" },
        userId: "user",
        messageId: "incoming",
        content: "hello",
        toJSON: () => ({ message: { content: "hello" } }),
    };
    core.receiveStimulus({ type: "user_message", channelCid: "qq:group", session });
    expect(core.pendingAssessments.has(key)).toBe(true);
    return {
        core,
        key,
        target,
        session,
        calculations,
        scheduled,
        advance: () => {
            now = 101;
        },
        release: () => release({ answers: { addressed: { noul: 0 }, interested: { noul: 1 }, others: { noul: 0 } } }),
    };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("does not replay a TypeSafe assessment after its pause rule expires", async () => {
    const test = await setup();
    test.advance();
    test.release();
    await settle();
    expect(test.calculations).toEqual([]);
    expect(test.scheduled).toEqual([]);
    expect(test.core.pendingAssessments.size).toBe(0);
});

it("combines allowed categories, bot-specific conversation keys and TypeSafe gains", async () => {
    const test = await setup();
    test.release();
    await settle();
    expect(test.calculations).toEqual([[test.session, test.key, ["text"], 1.5]]);
    expect(test.scheduled[0].channelCid).toBe(test.key);
});

it("does not replay an assessment that was cancelled by resume", async () => {
    const test = await setup();
    await test.core.replyControl.resume(test.target);
    test.release();
    await settle();
    expect(test.calculations).toEqual([]);
    expect(test.scheduled).toEqual([]);
});
