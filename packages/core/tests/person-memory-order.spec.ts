import { Bot, Context, Session } from "koishi";
import { expect, it } from "vitest";

import { EventListenerManager } from "../src/services/worldstate/event-listener";
import { WorldStateService } from "../src/services/worldstate/service";
import { Services } from "../src/shared/constants";

const beforeStimulus = "yesimbot/before-user-stimulus";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function fixture() {
    const ctx = new Context();
    const trace: string[] = [];
    const errors: unknown[][] = [];
    const memory = new Map<string, string>();
    const stimuli: Array<{ session: Session; payload: { messageIds: string[] }; memory?: string }> = [];
    ctx[Services.Logger] = {
        getLogger: () => ({
            debug() {},
            info() {},
            error(...args: unknown[]) {
                errors.push(args);
            },
        }),
    } as any;
    ctx[Services.Asset] = { transform: async (content: string) => content } as any;
    const world = Object.create(WorldStateService.prototype);
    world.config = { allowedChannels: [{ platform: "onebot", type: "guild", id: "allowed" }] };
    world.recordMessage = async () => {
        trace.push("message-recorded");
    };
    world.observeChannel = async () => {};
    const manager = new EventListenerManager(ctx, world, {} as any);
    const initialHooks = new Set(ctx.$processor._hooks);
    ctx.on("agent/stimulus", (stimulus) => {
        trace.push("stimulus");
        stimuli.push({ ...stimulus, memory: memory.get(stimulus.session.userId) });
    });

    // Use real Session filtering and serialization without starting an adapter.
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, { ctx, platform: "onebot", user: { id: "bot", name: "bot" } });
    function session(options: { channelId?: string; isBot?: boolean } = {}) {
        const value = bot.session({
            type: "message",
            channel: { id: options.channelId ?? "allowed", type: 0 },
            user: { id: "alice", name: "Alice", isBot: options.isBot ?? false },
            message: { id: "message-1" },
        }) as Session;
        value.content = "My name is Alice.";
        return value;
    }
    async function run(value: Session, downstream: () => Promise<void> = async () => {}) {
        const hooks = ctx.$processor._hooks.filter((hook) => !initialHooks.has(hook));
        async function next(index = 0): Promise<void> {
            if (index === hooks.length) {
                trace.push("downstream");
                await downstream();
                return;
            }
            await hooks[index].callback(value, () => next(index + 1));
        }
        await next();
    }
    return { ctx, manager, trace, errors, memory, stimuli, session, run };
}

for (const registration of ["before", "after"] as const) {
    it(`awaits person-memory capture when the hook registers ${registration} core middleware`, async () => {
        const f = fixture();
        const captureStarted = deferred();
        const finishCapture = deferred();
        let capturedSession: Session | undefined;
        const register = () =>
            f.ctx.on(beforeStimulus, async (session: Session) => {
                capturedSession = session;
                f.trace.push("capture-started");
                captureStarted.resolve();
                await finishCapture.promise;
                f.memory.set(session.userId, "Alice");
                f.trace.push("capture-saved");
            });
        if (registration === "before") register();
        f.manager.start();
        if (registration === "after") register();
        const session = f.session();
        const processing = f.run(session);
        try {
            // The old implementation finishes without ever entering the hook.
            await Promise.race([captureStarted.promise, processing]);
            expect(f.trace).toEqual(["message-recorded", "downstream", "capture-started"]);
            expect(capturedSession?.id).toBe(session.id);
            expect(f.stimuli).toHaveLength(0);
            finishCapture.resolve();
            await processing;
            expect(f.trace).toEqual(["message-recorded", "downstream", "capture-started", "capture-saved", "stimulus"]);
            expect(f.stimuli).toHaveLength(1);
            expect(f.stimuli[0].memory).toBe("Alice");
            expect(f.stimuli[0].session.id).toBe(session.id);
            expect(f.stimuli[0].payload.messageIds).toEqual(["message-1"]);
        } finally {
            finishCapture.resolve();
            await processing;
            f.manager.stop();
            await f.ctx.stop();
        }
    });
}

it("keeps an ordinary user stimulus available after optional capture rejects", async () => {
    const f = fixture();
    const error = new Error("person-memory unavailable");
    f.ctx.on(beforeStimulus, async () => {
        await Promise.resolve();
        throw error;
    });
    f.manager.start();
    try {
        const session = f.session();
        await f.run(session);
        expect(f.errors).toHaveLength(1);
        expect(f.errors[0]).toContain(error);
        expect(f.stimuli).toHaveLength(1);
        expect(f.stimuli[0].session.id).toBe(session.id);
    } finally {
        f.manager.stop();
        await f.ctx.stop();
    }
});

for (const rejection of ["synchronous throw", "async rejection"] as const) {
    it(`waits for a delayed capture despite another hook's ${rejection}`, async () => {
        const f = fixture();
        const error = new Error("optional preparation failed");
        const captureStarted = deferred();
        const finishCapture = deferred();
        f.ctx.on(beforeStimulus, () => {
            if (rejection === "synchronous throw") throw error;
            return Promise.reject(error);
        });
        f.ctx.on(beforeStimulus, async (session: Session) => {
            captureStarted.resolve();
            await finishCapture.promise;
            f.memory.set(session.userId, "Alice");
        });
        f.manager.start();
        const processing = f.run(f.session());
        try {
            await Promise.race([captureStarted.promise, processing]);
            // Give an incorrectly fail-fast dispatch time to emit its stimulus.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(f.stimuli).toHaveLength(0);
            finishCapture.resolve();
            await processing;
            expect(f.stimuli).toHaveLength(1);
            expect(f.stimuli[0].memory).toBe("Alice");
            expect(f.errors).toHaveLength(1);
            expect(f.errors[0]).toContain(error);
        } finally {
            finishCapture.resolve();
            await processing;
            f.manager.stop();
            await f.ctx.stop();
        }
    });
}

for (const excluded of ["command", "bot", "blocked channel"] as const) {
    it(`does not run person-memory capture or emit a user stimulus for a ${excluded}`, async () => {
        const f = fixture();
        f.ctx.on(beforeStimulus, async (session: Session) => {
            f.memory.set(session.userId, "Alice");
        });
        f.manager.start();
        try {
            const session = f.session({ isBot: excluded === "bot", channelId: excluded === "blocked channel" ? "blocked" : "allowed" });
            await f.run(session, async () => {
                if (excluded === "command") session["__commandHandled"] = true;
            });
            expect(f.memory.size).toBe(0);
            expect(f.stimuli).toHaveLength(0);
            expect(f.trace).toEqual(excluded === "command" ? ["message-recorded", "downstream"] : ["downstream"]);
        } finally {
            f.manager.stop();
            await f.ctx.stop();
        }
    });
}

it("filters preparation hooks using the incoming session's channel", async () => {
    const f = fixture();
    f.ctx.channel("blocked").on(beforeStimulus, async (session: Session) => {
        f.memory.set(session.userId, "wrong channel");
    });
    f.manager.start();
    try {
        await f.run(f.session());
        expect(f.memory.size).toBe(0);
        expect(f.stimuli).toHaveLength(1);
    } finally {
        f.manager.stop();
        await f.ctx.stop();
    }
});

it("emits normally after person-memory's preparation hook is disposed", async () => {
    const f = fixture();
    const dispose = f.ctx.on(beforeStimulus, async (session: Session) => {
        f.memory.set(session.userId, "disposed");
    });
    f.manager.start();
    dispose();
    try {
        await f.run(f.session());
        expect(f.memory.size).toBe(0);
        expect(f.stimuli).toHaveLength(1);
    } finally {
        f.manager.stop();
        await f.ctx.stop();
    }
});
