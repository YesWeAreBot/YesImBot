import { Schema } from "koishi";
import { afterEach, expect, it, vi } from "vitest";

import { AgentBehaviorConfigSchema } from "../src/agent/config";
import { StimulusScheduler } from "../src/agent/scheduler";
import { WillingnessManager } from "../src/agent/willing";
import { loggingStub } from "./helpers/yesimbot";

afterEach(() => vi.useRealTimers());

function setup(strategy = "skip", holdCompletion = false) {
    vi.useFakeTimers();
    const calls: any[] = [];
    let release!: () => void;
    const active = new Promise<void>((resolve) => (release = resolve));
    let releaseCompletion!: () => void;
    const completion = new Promise<void>((resolve) => (releaseCompletion = resolve));
    const scheduler = new StimulusScheduler(
        {
            debounce(fn: any, ms: number) {
                let timer: ReturnType<typeof setTimeout>;
                const task = (value: any) => {
                    clearTimeout(timer);
                    timer = setTimeout(() => void fn(value), ms);
                };
                task.dispose = () => clearTimeout(timer);
                return task;
            },
        } as any,
        { debounceMs: 10, prioritizeMentions: true, newMessageStrategy: strategy, deferredProcessingTime: 100 } as any,
        async (stimulus: any) => {
            calls.push(stimulus);
            if (stimulus.id === "active") await active;
            if (holdCompletion && stimulus.id === "done") await completion;
        },
        loggingStub(),
    );
    return { scheduler, calls, release, releaseCompletion };
}

function stimulus(id: string, type = "user_message", channelCid = "bot:group") {
    return {
        id,
        type,
        channelCid,
        payload: { taskIds: [id] },
        session: { selfId: "bot", bot: { selfId: "bot" }, stripped: { atSelf: id === "mention" }, elements: [] },
    } as any;
}

it("retains and coalesces completion events while busy under skip", async () => {
    const f = setup();
    f.scheduler.schedule(stimulus("active"));
    await vi.advanceTimersByTimeAsync(10);
    const first = stimulus("one", "background_task_completion");
    f.scheduler.schedule(first);
    f.scheduler.schedule(stimulus("two", "background_task_completion"));
    f.release();
    await vi.advanceTimersByTimeAsync(20);
    expect(f.calls.map((s) => s.id)).toEqual(["active", "two"]);
    expect(f.calls[1].payload.taskIds).toEqual(["one", "two"]);
    expect(first.payload.taskIds).toEqual(["one"]);
    f.scheduler.dispose();
});

for (const strategy of ["immediate", "deferred"]) {
    it(`keeps user mentions and quiet-period work independent of completions under ${strategy}`, async () => {
        const f = setup(strategy);
        f.scheduler.schedule(stimulus("active"));
        await vi.advanceTimersByTimeAsync(10);
        f.scheduler.schedule(stimulus("mention"));
        f.scheduler.schedule(stimulus("done", "background_task_completion"));
        f.release();
        await vi.advanceTimersByTimeAsync(110);
        expect(f.calls.map((s) => s.id)).toEqual(strategy === "immediate" ? ["active", "mention", "done"] : ["active", "done", "mention"]);
        f.scheduler.dispose();
    });
}

it("does not overwrite a debounced mention and isolates bots", async () => {
    const f = setup();
    f.scheduler.schedule(stimulus("mention"));
    f.scheduler.schedule(stimulus("done", "background_task_completion"));
    f.scheduler.schedule(stimulus("other", "background_task_completion", "other-bot:group"));
    await vi.advanceTimersByTimeAsync(20);
    expect(f.calls.map((s) => s.id)).toEqual(["other", "mention", "done"]);
    f.scheduler.dispose();
});

it("bounds retained completion identifiers", async () => {
    const f = setup();
    f.scheduler.schedule(stimulus("active"));
    await vi.advanceTimersByTimeAsync(10);
    for (let i = 0; i < 140; i++) f.scheduler.schedule(stimulus(`task-${i}`, "background_task_completion"));
    f.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.calls[1].payload.taskIds).toHaveLength(128);
    expect(f.calls[1].payload.taskIds[0]).toBe("task-12");
    f.scheduler.dispose();
});

it("runs a deferred user whose quiet period expires during completion processing before another completion", async () => {
    const f = setup("deferred", true);
    f.scheduler.schedule(stimulus("active"));
    await vi.advanceTimersByTimeAsync(10);
    f.scheduler.schedule(stimulus("mention"));
    f.scheduler.schedule(stimulus("done", "background_task_completion"));
    f.release();
    await vi.advanceTimersByTimeAsync(100);
    f.scheduler.schedule(stimulus("later", "background_task_completion"));
    f.releaseCompletion();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.calls.map((s) => s.id)).toEqual(["active", "done", "mention", "later"]);
    f.scheduler.dispose();
});

for (const action of ["cancel", "dispose"] as const) {
    it(`clears retained completions on ${action}`, async () => {
        const f = setup();
        f.scheduler.schedule(stimulus("active"));
        await vi.advanceTimersByTimeAsync(10);
        f.scheduler.schedule(stimulus("done", "background_task_completion"));
        if (action === "cancel") f.scheduler.cancel("bot:group");
        else f.scheduler.dispose();
        f.release();
        await vi.advanceTimersByTimeAsync(1000);
        expect(f.calls.map((s) => s.id)).toEqual(["active"]);
        f.scheduler.dispose();
    });
}

it("adds only background willingness, clamps at maximum and allows a zero-gain check", () => {
    const config = {
        base: { text: 12 },
        attribute: { atMention: 100, isQuote: 50, isDirectMessage: 100 },
        interest: { keywords: ["keyword"], keywordMultiplier: 10, defaultMultiplier: 2 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 55, probabilityAmplifier: 0.04 },
    };
    const willing = new WillingnessManager({ on() {} } as any, config as any, loggingStub());
    const session = { content: "keyword", stripped: { atSelf: true }, isDirect: true, resolve: (v: any) => v } as any;
    expect(willing.addBackgroundWillingness(session, "bot:group", 0)).toEqual({ score: 0, probability: 0 });
    expect(willing.addBackgroundWillingness(session, "bot:group", 60)).toEqual({ score: 60, probability: 0.2 });
    expect(willing.addBackgroundWillingness(session, "bot:group", 100)).toEqual({ score: 100, probability: 1 });
    for (const invalid of [0, -1, NaN, Infinity])
        expect(willing.addBackgroundWillingness(session, "bot:group", invalid)).toEqual({ score: 100, probability: 1 });
    expect(willing.addBackgroundWillingness(session, "other-bot:group", 0)).toEqual({ score: 0, probability: 0 });
});

it("defaults background execution off and validates bounded configuration", () => {
    const config = AgentBehaviorConfigSchema({});
    expect(config.backgroundTools).toEqual({
        enabled: false,
        allowedTools: ["web_search", "fetch_webpage", "get_image_description"],
        completion: "next_cycle",
        settlement: "request",
        willingness: { succeeded: 0, failed: 0, cancelled: 0 },
        maxConcurrent: 4,
        maxRetained: 128,
        timeoutMs: 120000,
    });
    expect(AgentBehaviorConfigSchema({ backgroundTools: { willingness: { succeeded: 0.5 } } }).backgroundTools.willingness.succeeded).toBe(0.5);
    for (const value of [-1, Infinity, NaN, 1000001])
        expect(() => AgentBehaviorConfigSchema({ backgroundTools: { willingness: { succeeded: value } } })).toThrow(/./);
    for (const value of [0, 33, 1.5]) expect(() => AgentBehaviorConfigSchema({ backgroundTools: { maxConcurrent: value } })).toThrow(/./);
    for (const value of [999, 3600001, 1000.5]) expect(() => AgentBehaviorConfigSchema({ backgroundTools: { timeoutMs: value } })).toThrow(/./);
});

it("decays background willingness without refreshing source-message activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const config = {
        base: { text: 0 },
        attribute: { atMention: 0, isQuote: 0, isDirectMessage: 0 },
        interest: { keywords: [], keywordMultiplier: 1, defaultMultiplier: 1 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 55, probabilityAmplifier: 0.04, decayHalfLifeSeconds: 100 },
    };
    const willing = new WillingnessManager({ on() {} } as any, config as any, loggingStub());
    const session = { resolve: (value: any) => value } as any;
    willing.addBackgroundWillingness(session, "chat", 20);
    willing.startDecayCycle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(willing.getCurrentWillingness("chat")).toBeCloseTo(20 * Math.pow(0.5, 1 / 100));
    willing.stopDecayCycle();
});

const topic = (key: string) => ({ currentScoreKey: key, multiplier: 1, candidates: [{ scoreKey: key, share: 1 }] });

function topicFixture() {
    const config = {
        base: { text: 12 },
        attribute: { atMention: 100, isQuote: 50, isDirectMessage: 100 },
        interest: { keywords: ["keyword"], keywordMultiplier: 10, defaultMultiplier: 2 },
        lifecycle: { maxWillingness: 100, probabilityThreshold: 55, probabilityAmplifier: 0.04, decayHalfLifeSeconds: 100, replyCost: 35 },
    };
    const willing = new WillingnessManager({ on() {} } as any, config as any, loggingStub());
    const session = { content: "keyword", stripped: { atSelf: true }, isDirect: true, bot: { selfId: "bot" }, resolve: (v: any) => v } as any;

    return { willing, session, topic };
}

it("moves background credit into the next current topic once without source-message gains", () => {
    const { willing, session, topic } = topicFixture();
    willing.addBackgroundWillingness(session, "chat", 60);
    const first = willing.shouldReply(session, "chat", [], 1, topic("topic-one"));
    expect(first.probability).toBe(0.2);
    expect(willing.getCurrentWillingness("topic-one")).toBe(60);
    expect(willing.getCurrentWillingness("chat")).toBe(0);
    willing.shouldReply(session, "chat", [], 1, topic("topic-two"));
    expect(willing.getCurrentWillingness("topic-two")).toBe(0);
    expect(willing.addBackgroundWillingness(session, "chat", 0)).toEqual({ score: 0, probability: 0 });
});

it("transfers only actual clamped background credit and honors reply cost", () => {
    const { willing, session, topic } = topicFixture();
    willing.addBackgroundWillingness(session, "chat", 500);
    willing.handlePostReply(session, "chat");
    willing.shouldReply(session, "chat", [], 1, topic("topic-one"));
    expect(willing.getCurrentWillingness("topic-one")).toBe(65);
    expect(willing.getCurrentWillingness("chat")).toBe(0);
});

it("leaves preexisting conversation willingness behind when transferring a clamped bonus", () => {
    const { willing, session, topic } = topicFixture();
    willing.shouldReply({ ...session, content: "", stripped: {}, isDirect: false }, "chat", ["text"]);
    expect(willing.getCurrentWillingness("chat")).toBe(24);
    willing.addBackgroundWillingness(session, "chat", 500);
    willing.shouldReply(session, "chat", [], 1, topic("topic-one"));
    expect(willing.getCurrentWillingness("topic-one")).toBe(76);
    expect(willing.getCurrentWillingness("chat")).toBe(24);
});

it("consumes pending transfer on a normal conversation decision or reset", () => {
    const { willing, session, topic } = topicFixture();
    willing.addBackgroundWillingness(session, "chat", 60);
    willing.shouldReply(session, "chat", []);
    willing.shouldReply(session, "chat", [], 1, topic("topic-one"));
    expect(willing.getCurrentWillingness("topic-one")).toBe(0);
    willing.addBackgroundWillingness(session, "other", 60);
    willing.reset("other");
    willing.shouldReply(session, "other", [], 1, topic("topic-two"));
    expect(willing.getCurrentWillingness("topic-two")).toBe(0);
});

it("decays pending topic credit and preserves it across stopping the decay timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const { willing, session, topic } = topicFixture();
    willing.addBackgroundWillingness(session, "chat", 20);
    willing.startDecayCycle();
    await vi.advanceTimersByTimeAsync(1000);
    willing.stopDecayCycle();
    willing.shouldReply(session, "chat", [], 1, topic("topic-one"));
    expect(willing.getCurrentWillingness("topic-one")).toBeCloseTo(20 * Math.pow(0.5, 1 / 100));
    expect(willing.getCurrentWillingness("chat")).toBe(0);
});

it("exposes ordinary numeric willingness inputs in the serialized configuration", () => {
    const schema = new Schema(JSON.parse(JSON.stringify(AgentBehaviorConfigSchema)));
    const background = schema.list.find((branch: any) => branch.dict?.backgroundTools).dict.backgroundTools;
    const willingness = background.dict.willingness;
    const fields = willingness.dict ?? willingness.list?.find((branch: any) => branch.type === "object")?.dict;
    for (const name of ["succeeded", "failed", "cancelled"]) {
        expect({ type: fields?.[name]?.type, meta: fields?.[name]?.meta }).toMatchObject({ type: "number", meta: { default: 0, min: 0, max: 1000000 } });
    }
    expect({ type: background.dict.allowedTools?.type, meta: background.dict.allowedTools?.meta }).toMatchObject({
        type: "array",
        meta: { role: "yib-dynamic", extra: { name: "toolService.backgroundEligibleTools" } },
    });
});
