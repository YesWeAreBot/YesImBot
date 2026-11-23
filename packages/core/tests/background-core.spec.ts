import { expect, it, vi } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { PromptContextBuilder } from "../src/agent/context-builder";
import { ReplyControl } from "../src/agent/reply-control";
import { WillingnessManager } from "../src/agent/willing";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

function fixture() {
    const session: any = {
        platform: "test",
        selfId: "b",
        channelId: "g",
        isDirect: true,
        userId: "u",
        content: "original",
        elements: [{ type: "at" }],
        stripped: { atSelf: true },
        resolve: (v: any) => v,
        bot: { selfId: "b" },
    };
    const config: any = {
        base: { text: 12 },
        attribute: { atMention: 100, isQuote: 15, isDirectMessage: 40 },
        interest: { keywords: [], defaultMultiplier: 1, keywordMultiplier: 1 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 50, probabilityAmplifier: 0.04, decayHalfLifeSeconds: 600 },
    };
    const ctx = stubCtx({}, { filter: () => true, on() {} });
    const willing = new WillingnessManager(ctx, config, loggingStub());
    const queued: any[] = [];
    let consumed = false,
        valid = true,
        muted = false;
    const background = {
        consumeCompletion: () => {
            if (consumed || !valid) return;
            consumed = true;
            return true;
        },
        isCompletionCurrent: () => valid,
    };
    const core: any = Object.create(AgentCore.prototype);
    Object.assign(core, {
        activeTurnSettlements: new Map(),
        resettingHistory: new Set(),
        historyTargets: new Map(),
        resetStimuli: new Map(),
        ctx,
        config,
        willing,
        toolService: { background },
        logger: { debug() {}, info() {}, warn() {} },
        worldState: { isBotMuted: () => muted },
        recordDecision() {},
        scheduler: { schedule: (s: any) => queued.push(s) },
    });
    core.replyControl = new ReplyControl(
        { load: async () => [], save: async () => {}, remove: async () => {} },
        () => {},
        async () => {},
    );
    const stimulus = {
        type: "background_task_completion",
        session,
        channelCid: "ignored",
        payload: { taskIds: ["one"], outcome: "succeeded", requestId: "r" },
    };
    return { core, session, willing, queued, stimulus, invalidate: () => (valid = false), mute: () => (muted = true) };
}
it("schedules an accepted continuation exactly once with zero willingness", () => {
    const f = fixture();
    f.core.processStimulus(f.stimulus);
    f.core.processStimulus(f.stimulus);
    expect(f.willing.getCurrentWillingness(JSON.stringify(["test", "b", "g"]))).toBe(0);
    expect(f.queued).toHaveLength(1);
});
it.each(["invalidate", "mute"] as const)("does not award or schedule after %s", (change) => {
    const f = fixture();
    f[change]();
    f.core.processStimulus(f.stimulus);
    expect(f.queued).toEqual([]);
    expect(f.willing.getCurrentWillingness(JSON.stringify(["test", "b", "g"]))).toBe(0);
});
it("injects scoped task snapshots and completion metadata into each prompt context", async () => {
    const f = fixture();
    const builder = new PromptContextBuilder(stubCtx({}, { filter: () => true, on() {} }), {} as any, {
        model: {} as any,
        logging: loggingStub(),
        asset: {} as any,
        tool: { getToolSchemas: () => [], background: { readContinuation: async () => ({ tasks: [{ id: "one", state: "succeeded" }] }) } } as any,
        memory: { getMemoryBlocksForRendering: () => [] } as any,
        world: {
            isChannelAllowed: () => true,
            l2_manager: { getHistoryGeneration: () => 0 },
            buildWorldState: async () => ({ l1_working_memory: { processed_events: [], new_events: [] } }),
        } as any,
    });
    const result: any = await builder.build(f.stimulus as any);
    expect(result.worldState.backgroundTasks).toBeUndefined();
    expect(result.worldState.triggerContext).toMatchObject({ isBackgroundTaskCompletion: true, tasks: [{ id: "one", state: "succeeded" }] });
});
it("revalidates queued completion ownership before entering a model cycle", async () => {
    vi.useFakeTimers();
    const { Context } = await import("koishi");
    const { Config } = await import("../src/config");
    const ctx = new Context();
    const f = fixture();
    let cycles = 0;
    const core = new AgentCore(ctx, Config({ debounceMs: 1 }), {
        logging: loggingStub(),
        world: { isBotMuted: () => false } as any,
        model: { useChatGroup: () => ({}) } as any,
        prompt: {} as any,
        tool: f.core.toolService,
        asset: {} as any,
        memory: {} as any,
    });
    (core as any).processor = {
        runCycle: async () => {
            cycles++;
            return false;
        },
    };
    f.invalidate();
    (core as any).scheduler.schedule(f.stimulus);
    await vi.advanceTimersByTimeAsync(5);
    expect(cycles).toBe(0);
    await core.stop();
    await ctx.stop();
    vi.useRealTimers();
});
