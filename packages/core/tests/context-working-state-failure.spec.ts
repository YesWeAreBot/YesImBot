import { expect, it, vi } from "vitest";

import { PromptContextBuilder } from "../src/agent/context-builder";
import { withReplyTurn } from "../src/agent/reply-turn";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

function fixture(read: () => Promise<unknown>) {
    const warn = vi.fn<(...args: unknown[]) => void>();
    const ctx = stubCtx({}, { filter: (_session: unknown) => true });
    const world = {
        buildWorldState: async () => ({ l1_working_memory: { processed_events: [], new_events: [] } }),
        getConversationState: read,
        isChannelAllowed: (_session: unknown) => true,
        l2_manager: { getHistoryGeneration: (_target: unknown) => 0 },
    };
    const builder = new PromptContextBuilder(ctx, {} as any, {
        model: {} as any,
        logging: loggingStub({ debug() {}, warn }),
        asset: {} as any,
        tool: { getToolSchemas: () => [] } as any,
        memory: { getMemoryBlocksForRendering: () => [] } as any,
        world: world as any,
    });
    const stimulus: any = { type: "user_message", session: { platform: "test", selfId: "bot", channelId: "room" }, payload: { messageIds: [] } };
    return { build: () => builder.build(stimulus), warn, ctx, world, stimulus };
}

it("continues building ordinary context with unknown working state when its database read fails", async () => {
    const f = fixture(async () => {
        throw new Error("database unavailable");
    });
    const built = await f.build();
    expect(built.worldState.conversationFocus?.explicitWorkingState).toMatchObject({ unknown: true });
    expect(built.worldState.l1_working_memory).toEqual({ processed_events: [], new_events: [] });
    expect(f.warn).toHaveBeenCalledOnce();
});

it("propagates an explicit cancellation from the optional working-state read", async () => {
    const cancelled = new DOMException("cancelled", "AbortError");
    const f = fixture(async () => {
        throw cancelled;
    });
    await expect(f.build()).rejects.toBe(cancelled);
    expect(f.warn).not.toHaveBeenCalled();
});

it("does not turn a cancelled reply turn into an unknown working state", async () => {
    let valid = true;
    const f = fixture(async () => {
        valid = false;
        throw new Error("late database error");
    });
    await expect(
        withReplyTurn(
            () => valid,
            () => f.build(),
        ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.warn).not.toHaveBeenCalled();
});

for (const change of ["context-filter", "channel-config", "identity", "history-generation"] as const) {
    it(`does not swallow ${change} changes during a failed optional state read`, async () => {
        const f = fixture(async () => {
            if (change === "context-filter") f.ctx.filter = () => false;
            if (change === "channel-config") f.world.isChannelAllowed = () => false;
            if (change === "identity") f.stimulus.session.channelId = "another-room";
            if (change === "history-generation") f.world.l2_manager.getHistoryGeneration = () => 1;
            throw new Error("state read rejected after scope change");
        });
        await expect(f.build()).rejects.toThrow(/身份|授权|配置|历史/);
        expect(f.warn).not.toHaveBeenCalled();
    });
}

it("projects validated working sources into context without writing history or treating them as new messages", async () => {
    const source: any = {
        id: "original",
        platform: "test",
        channelId: "room",
        channelType: "guild",
        sender: { id: "alice" },
        timestamp: new Date(0),
        content: '<at id="bot"/> Original request',
    };
    const f = fixture(async () => ({
        unknown: false,
        state: { revision: 1, topic: "task", openIssues: [], sourceMessageIds: ["original"] },
        sourceMessages: [source],
    }));
    const builder = new PromptContextBuilder(f.ctx, { continuation: { enabled: true } } as any, {
        model: {} as any,
        logging: loggingStub(),
        asset: {} as any,
        memory: { getMemoryBlocksForRendering: () => [] } as any,
        tool: { getToolSchemas: () => [] } as any,
        world: f.world as any,
    });
    const original = await f.world.buildWorldState();
    f.world.buildWorldState = async () => original;
    const result = await builder.build(f.stimulus);
    expect(result.worldState.l1_working_memory.processed_events).toMatchObject([{ id: "original", content: source.content, is_new: false }]);
    expect(result.worldState.conversationFocus?.missingMessageIds).toEqual([]);
    expect(original.l1_working_memory.processed_events).toEqual([]);
});

it("restores the original request for a background completion without counting it as a new message", async () => {
    const f = fixture(async () => ({ unknown: true }));
    f.stimulus.type = "background_task_completion";
    f.stimulus.session.messageId = "original";
    (f.world as any).readMessageWindow = async () => ({
        anchor: { id: "original", sender: { id: "alice" }, content: "Original request", timestamp: new Date(0) },
        quotes: [],
    });
    const result = await f.build();
    expect(result.worldState.conversationFocus).toMatchObject({ triggerMessageIds: ["original"], missingMessageIds: [] });
    expect(result.worldState.l1_working_memory.processed_events).toMatchObject([{ id: "original", is_new: false }]);
});

it("refuses a queued continuation whose working state was replaced before context preparation", async () => {
    const f = fixture(async () => ({ unknown: true }));
    f.stimulus.continuationRequired = true;
    f.stimulus.continuation = {
        mode: "trigger",
        revision: 1,
        sourceMessageIds: ["original"],
        expiresAt: Date.now() + 60000,
        registeredAt: new Date().toISOString(),
    };
    await expect(f.build()).rejects.toMatchObject({ name: "AbortError" });
});

it("keeps independently admitted messages when their optional continuation expires", async () => {
    const f = fixture(async () => ({ unknown: true }));
    f.stimulus.continuationRequired = false;
    f.stimulus.continuation = { mode: "trigger", revision: 1, sourceMessageIds: ["original"], expiresAt: 1, registeredAt: new Date(0).toISOString() };
    const result = await f.build();
    expect(result.worldState.conversationFocus?.continuation).toBeUndefined();
});
