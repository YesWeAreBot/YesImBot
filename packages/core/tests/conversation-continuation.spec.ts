import { expect, it } from "vitest";

import { matchContinuation } from "../src/agent/continuation";

const config = { enabled: true, mode: "trigger" as const, willingnessGain: 35, maxDurationSeconds: 300 };
const session: any = { userId: "alice", selfId: "bot", elements: [], stripped: {} };
const state: any = {
    unknown: false,
    state: { revision: 3, sourceMessageIds: ["source"], updatedAt: new Date(1000).toISOString(), followUp: { userIds: ["alice"], expiresAt: 61000 } },
};
it("matches only an explicitly registered recipient in the bounded waiting interval", () => {
    expect(matchContinuation(session, config, state, 2000)).toMatchObject({ revision: 3, mode: "trigger", sourceMessageIds: ["source"] });
    for (const now of [0, 61000, 62000]) expect(matchContinuation(session, config, state, now)).toBeUndefined();
    expect(matchContinuation({ ...session, userId: "bob" }, config, state, 2000)).toBeUndefined();
    expect(matchContinuation(session, { ...config, enabled: false }, state, 2000)).toBeUndefined();
    expect(matchContinuation(session, config, { unknown: true }, 2000)).toBeUndefined();
    expect(matchContinuation(session, { ...config, maxDurationSeconds: 1 }, state, 2000)).toBeUndefined();
});
it("does not reinterpret messages addressed to someone else as continuation", () => {
    for (const extra of [{ elements: [{ type: "at", attrs: { id: "bob" } }] }, { quote: { user: { id: "bob" } } }])
        expect(matchContinuation({ ...session, ...extra }, config, state, 2000)).toBeUndefined();
    expect(matchContinuation({ ...session, elements: [{ type: "at", attrs: { id: "bot" } }] }, config, state, 2000)).toBeDefined();
});
it("returns isolated anchor metadata and the administrator's selected mode", () => {
    const result = matchContinuation(session, { ...config, mode: "willingness" }, state, 2000)!;
    expect(result.mode).toBe("willingness");
    result.sourceMessageIds.push("mutated");
    expect(state.state.sourceMessageIds).toEqual(["source"]);
});

it("keeps continuation disabled for existing configurations and exposes native settings", async () => {
    const { AgentBehaviorConfigSchema } = await import("../src/agent/config");
    const { Schema } = await import("koishi");
    const defaults = AgentBehaviorConfigSchema({}).continuation;
    expect(defaults).toEqual({ enabled: false, mode: "trigger", willingnessGain: 35, maxDurationSeconds: 300 });
    const hydrated = new Schema(JSON.parse(JSON.stringify(AgentBehaviorConfigSchema)));
    expect(hydrated({ continuation: { enabled: true, mode: "willingness" } }).continuation).toMatchObject({
        enabled: true,
        mode: "willingness",
        willingnessGain: 35,
    });
    for (const continuation of [{ maxDurationSeconds: 0 }, { maxDurationSeconds: 86401 }, { willingnessGain: -1 }, { mode: "unknown" }])
        expect(() => AgentBehaviorConfigSchema({ continuation })).toThrow(/./);
});

it.each([true, false])("revalidates only continuation-dependent scheduled work (required=%s)", async (required) => {
    const { vi } = await import("vitest");
    const { Context } = await import("koishi");
    const { AgentCore } = await import("../src/agent/agent-core");
    const { Config } = await import("../src/config");
    const { loggingStub } = await import("./helpers/yesimbot");
    vi.useFakeTimers();
    const ctx = new Context();
    let cycles = 0;
    const core = new AgentCore(ctx, Config({ debounceMs: 1, continuation: config }), {
        logging: loggingStub(),
        world: { isBotMuted: () => false, getConversationState: async () => ({ unknown: true }) } as any,
        model: { useChatGroup: () => ({}) } as any,
        prompt: {} as any,
        tool: {} as any,
        asset: {} as any,
        memory: {} as any,
    });
    (core as any).processor = {
        runCycle: async () => {
            cycles++;
            return false;
        },
    };
    try {
        (core as any).scheduler.schedule({
            type: "user_message",
            channelCid: JSON.stringify(["qq", "bot", "room"]),
            session: { platform: "qq", selfId: "bot", channelId: "room", userId: "alice", bot: { selfId: "bot" }, elements: [], stripped: {} },
            continuation: {
                mode: "trigger",
                revision: 1,
                registeredAt: new Date().toISOString(),
                expiresAt: Date.now() + 60000,
                sourceMessageIds: ["original"],
            },
            continuationRequired: required,
        });
        await vi.advanceTimersByTimeAsync(10);
        expect(cycles).toBe(required ? 0 : 1);
    } finally {
        await core.stop();
        await ctx.stop();
        vi.useRealTimers();
    }
});
