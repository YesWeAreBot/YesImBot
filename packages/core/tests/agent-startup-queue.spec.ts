import { expect, it, vi } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { TypeSafeEvaluator } from "../src/agent/typesafe";
import { prepareHistoryReset } from "../src/world/history-reset";
import { loggingStub } from "./helpers/yesimbot";

function fixture() {
    const listeners = new Map<string, Function[]>();
    let finish!: () => void;
    const initialized = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let allowed = true;
    let generation = 0;
    const command: any = {};
    for (const method of ["action", "option", "alias", "usage", "example", "subcommand"]) command[method] = () => command;
    const ctx: any = {
        on: (event: string, callback: Function) => {
            const list = listeners.get(event) ?? [];
            listeners.set(event, [...list, callback]);
            return () =>
                listeners.set(
                    event,
                    (listeners.get(event) ?? []).filter((item) => item !== callback),
                );
        },
        filter: () => allowed,
        model: { extend() {} },
        command: () => command,
        setInterval: () => () => {},
        database: { get: () => initialized.then(() => []), upsert: async () => {}, remove: async () => {} },
    };
    const core: any = new AgentCore(ctx, {} as any, {
        logging: loggingStub(),
        world: { stimulusOwnerId: "owner", isChannelAllowed: () => true, l2_manager: { getHistoryGeneration: () => generation } } as any,
        model: { useChatGroup: () => ({}) } as any,
        prompt: { registerTemplate() {}, registerSnippet() {} } as any,
        tool: {} as any,
        asset: {} as any,
        memory: {} as any,
    });
    const receive = core.receiveStimulus.bind(core);
    const received: string[] = [];
    core.receiveStimulus = (stimulus: any) => received.push(stimulus.session.messageId);
    core.willing.startDecayCycle = vi.fn<() => void>();
    const emit = (id: string, owner = "owner") => {
        for (const listener of listeners.get("agent/stimulus") ?? []) {
            listener({ type: "user_message", session: { platform: "qq", channelId: "g", selfId: "bot", messageId: id } }, owner);
        }
    };
    return {
        ctx,
        core,
        receive,
        finish,
        received,
        emit,
        listeners,
        disallow: () => {
            allowed = false;
        },
        clearHistory: () => {
            generation++;
        },
    };
}

it("replays stimuli received before and during startup only after reply rules initialize", async () => {
    const f = fixture();
    f.emit("before-start");
    const starting = f.core.start();
    f.emit("during-start");
    f.emit("foreign-instance", "another-owner");
    expect(f.received).toEqual([]);
    f.finish();
    await starting;
    f.emit("after-start");
    expect(f.received).toEqual(["before-start", "during-start", "after-start"]);
});

it("rechecks the plugin scope before replaying queued stimuli", async () => {
    const f = fixture();
    f.emit("revoked");
    const starting = f.core.start();
    f.disallow();
    f.finish();
    await starting;
    expect(f.received).toEqual([]);
});

it("does not replay startup stimuli after the plugin is disposed", async () => {
    const f = fixture();
    const starting = f.core.start();
    f.emit("old");
    for (const listener of f.listeners.get("dispose") ?? []) listener();
    f.finish();
    await starting;
    f.emit("late");
    expect(f.received).toEqual([]);
});

it("does not replay a queued stimulus after its conversation history is cleared", async () => {
    const f = fixture();
    f.emit("cleared");
    const starting = f.core.start();
    f.clearHistory();
    f.emit("current");
    f.finish();
    await starting;
    expect(f.received).toEqual(["current"]);
});

it("clears old startup stimuli, willingness and active assessments before awaiting reset", async () => {
    const f = fixture();
    f.emit("old");
    const turn = new AbortController();
    const assessment = new AbortController();
    f.core.activeTurns.set("channel", turn);
    f.core.pendingAssessments.set("channel", { controller: assessment, stimulus: { session: {} }, token: 0 });
    f.core.willing.willingnessScores.set("channel", 80);
    f.core.willing.participation.set("channel", { active: true });
    const reset = prepareHistoryReset(f.ctx as any, { type: "all" });
    expect(turn.signal.aborted).toBe(true);
    expect(assessment.signal.aborted).toBe(true);
    expect(f.core.willing.getCurrentWillingness("channel")).toBe(0);
    f.emit("during-reset");
    f.finish();
    await f.core.start();
    expect(f.received).toEqual([]);
    await reset.ready;
    await reset.finish();
    f.emit("fresh");
    expect(f.received).toEqual(["during-reset", "fresh"]);
});

it("keeps overlapping resets fenced until the last reset finishes", async () => {
    const f = fixture();
    f.finish();
    await f.core.start();
    const scope = { type: "all" } as const;
    const first = prepareHistoryReset(f.ctx as any, scope);
    const second = prepareHistoryReset(f.ctx as any, scope);
    await first.finish();
    f.emit("still-clearing");
    expect(f.received).toEqual([]);
    await second.finish();
    f.emit("after-both");
    expect(f.received).toEqual(["still-clearing", "after-both"]);
});

for (const outcome of ["success", "failure"] as const)
    it(`does not schedule an old semantic assessment after clear and late ${outcome}`, async () => {
        const f = fixture();
        f.core.receiveStimulus = f.receive;
        f.core.worldState.isBotMuted = () => false;
        f.core.config.typesafe = { mode: "adjust", evaluationModel: { providerName: "p", modelId: "m" } };
        const scheduled = vi.fn<() => void>();
        f.core.processStimulus = scheduled;
        let resolve!: (value: number) => void;
        let reject!: (error: Error) => void;
        const evaluator = vi.spyOn(TypeSafeEvaluator.prototype, "evaluate").mockImplementation(
            () =>
                new Promise((r, j) => {
                    resolve = r;
                    reject = j;
                }),
        );
        try {
            f.finish();
            await f.core.start();
            f.emit("old-assessment");
            expect(evaluator).toHaveBeenCalledOnce();
            const reset = prepareHistoryReset(f.ctx as any, { type: "all" });
            await reset.finish();
            if (outcome === "success") resolve(1);
            else reject(new Error("late upstream failure"));
            for (let i = 0; i < 8; i++) await Promise.resolve();
            expect(scheduled).not.toHaveBeenCalled();
        } finally {
            evaluator.mockRestore();
        }
    });

for (const lateOutcome of ["success", "failure"] as const)
    it(`releases a stuck old processor and preserves fresh work before its late ${lateOutcome}`, async () => {
        vi.useFakeTimers();
        const f = fixture();
        f.core.receiveStimulus = f.receive;
        f.core.config.debounceMs = 1;
        f.core.config.newMessageStrategy = "skip";
        f.ctx.debounce = ((callback: Function, delay: number) => {
            let timer: ReturnType<typeof setTimeout>;
            const run: any = (value: unknown) => {
                clearTimeout(timer);
                timer = setTimeout(() => void callback(value), delay);
            };
            run.dispose = () => clearTimeout(timer);
            return run;
        }) as any;
        f.core.worldState.isBotMuted = () => false;
        f.core.willing.shouldReply = () => ({ decision: true, probability: 1 });
        f.core.willing.handlePreReply = () => {};
        let releaseOld!: () => void;
        const remote = new Promise<void>((resolve, reject) => {
            releaseOld = lateOutcome === "success" ? resolve : () => reject(new Error("late transport failure"));
        });
        const started: string[] = [];
        let staleWrites = 0;
        const { assertReplyTurn } = await import("../src/agent/reply-turn");
        f.core.processor.runCycle = async (stimulus: any) => {
            started.push(stimulus.session.messageId);
            if (started.length === 1) {
                await remote; // Deliberately ignores cancellation, as a broken transport might.
                assertReplyTurn();
                staleWrites++;
            }
            return false;
        };
        const emit = (messageId: string) => {
            for (const listener of f.listeners.get("agent/stimulus") ?? []) listener({ type: "user_message", session: schedulerSession(messageId) }, "owner");
        };
        try {
            f.finish();
            await f.core.start();
            emit("old");
            await vi.advanceTimersByTimeAsync(2);
            expect(started).toEqual(["old"]);
            const reset = prepareHistoryReset(f.ctx as any, { type: "all" });
            f.clearHistory();
            emit("fresh");
            await reset.ready;
            await reset.finish();
            await vi.advanceTimersByTimeAsync(2);
            expect(started).toEqual(["old", "fresh"]);
            releaseOld();
            await vi.advanceTimersByTimeAsync(1);
            expect(staleWrites).toBe(0);
        } finally {
            releaseOld();
            f.core.scheduler.dispose();
            vi.useRealTimers();
        }
    });

function schedulerSession(messageId: string) {
    return { platform: "qq", channelId: "g", selfId: "bot", messageId, bot: { platform: "qq", selfId: "bot" } };
}
