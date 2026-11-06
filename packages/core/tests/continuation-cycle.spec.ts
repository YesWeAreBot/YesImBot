import { afterEach, expect, it, vi } from "vitest";

import { PromptContextBuilder } from "../src/agent/context-builder";
import { matchContinuation } from "../src/agent/continuation";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { withReplyTurnGuard } from "../src/agent/reply-turn";
import { Config } from "../src/config";
import { loggingStub } from "./helpers/yesimbot";

// Run the real context/model/action loop: clearing the wait is a normal first action,
// while sending the answer belongs to the next heartbeat.
function cycleFixture(afterUpdate: () => void = () => {}) {
    const config = Config({ heartbeat: 3, streamAction: false, nativeToolCalling: false, continuation: { enabled: true, mode: "trigger" } });
    const session: any = {
        platform: "qq",
        selfId: "bot",
        channelId: "room",
        userId: "alice",
        elements: [],
        stripped: {},
        bot: { platform: "qq", selfId: "bot" },
    };
    let working: any = {
        unknown: false,
        state: {
            revision: 1,
            topic: "pending",
            openIssues: [],
            sourceMessageIds: ["old"],
            updatedAt: new Date().toISOString(),
            followUp: { userIds: ["alice"], expiresAt: Date.now() + 60000 },
        },
    };
    const stimulus: any = {
        type: "user_message",
        session,
        payload: { messageIds: ["new"] },
        continuationRequired: true,
        continuation: matchContinuation(session, config.continuation, working),
    };
    const deliveries: string[] = [];
    let modelCalls = 0;
    const model: any = {
        hasVisionCapability: () => false,
        chat: async () => ({
            text: JSON.stringify({
                thoughts: {},
                actions:
                    ++modelCalls === 1
                        ? [{ function: "conversation_state_update", params: {} }]
                        : [{ function: "send_message", params: { content: "answer" } }],
                request_heartbeat: modelCalls === 1,
            }),
        }),
    };
    const world: any = {
        buildWorldState: async () => ({ l1_working_memory: { processed_events: [], new_events: [] } }),
        getConversationState: async () => working,
    };
    const tool: any = {
        getToolSchemas: () => [],
        invoke: async (name: string, params: any) => {
            if (name === "conversation_state_update") afterUpdate();
            else deliveries.push(params.content);
            return { status: "success", result: {} };
        },
    };
    const logging = loggingStub();
    const contextBuilder = new PromptContextBuilder({} as any, config, {
        model,
        world,
        tool,
        logging,
        asset: {} as any,
        memory: { getMemoryBlocksForRendering: () => [] } as any,
    });
    const processor = new HeartbeatProcessor({} as any, config, {
        model,
        world,
        tool,
        logging,
        contextBuilder,
        prompt: { render: async () => "context" } as any,
        l1: { recordHeartbeat: async () => {}, recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
    });
    return {
        processor,
        stimulus,
        deliveries,
        world,
        modelCalls: () => modelCalls,
        clearWait: () => {
            working = { ...working, state: { ...working.state, revision: 2, followUp: undefined } };
        },
    };
}

afterEach(() => vi.useRealTimers());

it("admits continuation once per cycle when its own state update clears the wait", async () => {
    const fixture = cycleFixture(() => fixture.clearWait());
    expect(await fixture.processor.runCycle(fixture.stimulus)).toBe(true);
    expect(fixture.deliveries).toEqual(["answer"]);
    expect(fixture.modelCalls()).toBe(2);
    expect(fixture.stimulus.continuationRequired).toBe(true);
    // Reusing even the same stimulus must perform fresh admission.
    expect(await fixture.processor.runCycle(fixture.stimulus)).toBe(false);
    expect(fixture.modelCalls()).toBe(2);
});

it("allows an admitted cycle to answer after its waiting interval expires", async () => {
    vi.useFakeTimers();
    const fixture = cycleFixture(() => vi.setSystemTime(Date.now() + 61000));
    expect(await fixture.processor.runCycle(fixture.stimulus)).toBe(true);
    expect(fixture.deliveries).toEqual(["answer"]);
    expect(await fixture.processor.runCycle(fixture.stimulus)).toBe(false);
    expect(fixture.modelCalls()).toBe(2);
});

it.each(["replaced", "expired"])("rejects %s continuation before the first model call", async (reason) => {
    vi.useFakeTimers();
    const fixture = cycleFixture();
    if (reason === "replaced") fixture.clearWait();
    else vi.setSystemTime(Date.now() + 61000);
    expect(await fixture.processor.runCycle(fixture.stimulus)).toBe(false);
    expect(fixture.modelCalls()).toBe(0);
    expect(fixture.deliveries).toEqual([]);
});

it("still cancels an admitted cycle before the next heartbeat", async () => {
    const controller = new AbortController();
    const fixture = cycleFixture(() => controller.abort());
    expect(
        await withReplyTurnGuard(
            () => true,
            () => fixture.processor.runCycle(fixture.stimulus),
            controller.signal,
        ),
    ).toBe(false);
    expect(fixture.modelCalls()).toBe(1);
    expect(fixture.deliveries).toEqual([]);
});

it("still aborts an admitted cycle when channel history is cleared", async () => {
    let generation = 0;
    let onClear: (() => void) | undefined;
    const fixture = cycleFixture(() => {
        generation++;
        onClear?.();
    });
    fixture.world.l2_manager = {
        getHistoryGeneration: () => generation,
        watchHistory: (_target: unknown, listener: () => void) => {
            onClear = listener;
            return () => {};
        },
    };
    expect(await fixture.processor.runCycle(fixture.stimulus)).toBe(false);
    expect(fixture.modelCalls()).toBe(1);
    expect(fixture.deliveries).toEqual([]);
});
