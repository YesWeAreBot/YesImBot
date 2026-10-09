// Agent reply regressions use built core; state/event methods are tested from source.
import { expect, it, spyOn } from "bun:test";

import { Bot, Context, MessageEncoder } from "koishi";

import { AgentCore } from "../lib/agent/agent-core";
import { replyTurnSignal } from "../lib/agent/reply-turn";
import { Config } from "../lib/config";
import CoreUtilExtension from "../lib/services/extension/builtin/core-util";
import { EventListenerManager } from "../src/services/worldstate/event-listener";
import { WorldStateService } from "../src/services/worldstate/service";
import { Services, TableName } from "../src/shared/constants";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
export function muteFixture(rows: any[] = []) {
    const ctx = new Context();
    ctx[Services.Logger] = { getLogger: () => logger } as any;
    ctx.bots.push({ platform: "onebot", selfId: "a" } as any, { platform: "onebot", selfId: "b" } as any, { platform: "other", selfId: "a" } as any);
    let reads = 0;
    const states: any[] = [];
    ctx.database = {
        upsert: async (_table: string, values: any[]) => {
            for (const value of values) {
                const existing = states.find((row) => row.id === value.id);
                if (existing) Object.assign(existing, value);
                else states.push({ ...value });
            }
        },
        get: async (_table: string, query: any) => {
            if (_table === TableName.BotMuteState) return states;
            reads++;
            return rows.filter(
                (row) =>
                    (!query.type || (typeof query.type === "string" ? row.type === query.type : query.type.$in.includes(row.type))) &&
                    (!query.platform || row.platform === query.platform) &&
                    (!query.channelId || row.channelId === query.channelId) &&
                    (!query.timestamp || (row.timestamp >= query.timestamp.$gte && row.timestamp <= query.timestamp.$lte)),
            );
        },
    } as any;
    const world: any = Object.create(WorldStateService.prototype);
    Object.defineProperty(world, "ctx", { value: ctx });
    Object.defineProperty(world, "logger", { value: logger });
    Object.assign(world, {
        mutedChannels: new Map(),
        allMutedChannels: new Map(),
        l2_manager: {
            getHistoryGeneration: () => 0,
            writeMemory: async (_target: any, _generation: number, write: Function) => {
                await write();
                return true;
            },
        },
    });
    const recorded: any[] = [];
    world.l1_manager = {
        recordSystemEvent: async (event: any) => {
            recorded.push(event);
        },
    };
    return { ctx, world, recorded, reads: () => reads };
}
function event(type: string, user: string | undefined, time: number, duration?: number, selfId?: string, platform = "onebot") {
    return {
        platform,
        channelId: "g",
        type,
        timestamp: new Date(time),
        payload: { details: { user: user ? { id: user } : undefined, duration, selfId } },
    };
}
function notice(selfId: string, userId: number | string, duration: number, sub_type = duration === 0 ? "lift_ban" : "ban"): any {
    return {
        platform: "onebot",
        selfId,
        bot: { selfId },
        cid: "onebot:g",
        channelId: "g",
        subtype: "ban",
        event: {
            user: String(userId) !== "0" ? { id: String(userId) } : undefined,
            operator: { id: "operator" },
            _data: { user_id: userId, duration, sub_type },
        },
    };
}

it("isolates individual mute by platform, channel and bot account", () => {
    const { world } = muteFixture();
    world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    expect(world.isBotMuted("onebot:g", "a")).toBe(true);
    expect(world.isBotMuted("onebot:g", "b")).toBe(false);
    expect(world.isBotMuted("other:g", "a")).toBe(false);
    expect(world.isBotMuted("onebot:other", "a")).toBe(false);
});

it("keeps whole-group and individual mute independent in both release orders", () => {
    for (const first of ["all", "individual"]) {
        const { world } = muteFixture();
        world.updateMuteStatus("onebot:g", Infinity, "a", "all");
        world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
        world.updateMuteStatus("onebot:g", 0, "a", first);
        expect(world.isBotMuted("onebot:g", "a")).toBe(true);
        world.updateMuteStatus("onebot:g", 0, "a", first === "all" ? "individual" : "all");
        expect(world.isBotMuted("onebot:g", "a")).toBe(false);
    }
});

it("expires at the deadline and keeps diagnostics a pure read", () => {
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    try {
        const { world } = muteFixture();
        world.updateMuteStatus("onebot:g", 2000, "a");
        clock.mockReturnValue(2000);
        expect(world.peekBotMuted("onebot:g", "a")).toBe(false);
        clock.mockReturnValue(1999);
        expect(world.peekBotMuted("onebot:g", "a")).toBe(true);
    } finally {
        clock.mockRestore();
    }
});

it("recognizes numeric/string zero target as whole-group lift without clearing individual mute", async () => {
    for (const userId of [0, "0"]) {
        const { ctx, world, recorded } = muteFixture();
        const listener: any = new EventListenerManager(ctx, world, {} as any);
        await listener.handleGuildMember(notice("a", userId, -1));
        world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
        await listener.handleGuildMember(notice("a", userId, 0));
        expect(world.isBotMuted("onebot:g", "a")).toBe(true);
        await listener.handleGuildMember(notice("a", "a", 0));
        expect(world.isBotMuted("onebot:g", "a")).toBe(false);
        expect(recorded.at(-2).type).toBe("guild-all-member-unban");
        expect(recorded[0].payload.details.selfId).toBe("a");
    }
});

it("ignores malformed durations and unrelated member releases", async () => {
    const { ctx, world, recorded } = muteFixture();
    const listener: any = new EventListenerManager(ctx, world, {} as any);
    world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    await listener.handleGuildMember({ ...notice("a", 10, 0), event: { user: { id: "other" }, _data: { duration: 0 } } });
    await listener.handleGuildMember({ ...notice("a", 10, 0), event: { user: { id: "a" }, _data: { duration: "invalid" } } });
    for (const duration of [null, undefined, "", Infinity, -1]) {
        await listener.handleGuildMember({ ...notice("a", "a", 0), event: { user: { id: "a" }, _data: { duration } } });
    }
    expect(world.isBotMuted("onebot:g", "a")).toBe(true);
    expect(recorded).toHaveLength(1);
});

it("restores by target member and platform; another member's release does not unmute the bot", async () => {
    const now = Date.now();
    const { world, reads } = muteFixture([
        event("guild-member-unban", "someone", now - 1000),
        event("guild-member-ban", "a", now - 2000, 60000),
        event("guild-member-ban", "b", now - 3000, 60000),
        event("guild-member-unban", "b", now - 500),
    ]);
    await world.initializeMuteStatus();
    expect(world.isBotMuted("onebot:g", "a")).toBe(true);
    expect(world.isBotMuted("onebot:g", "b")).toBe(false);
    expect(world.isBotMuted("other:g", "a")).toBe(false);
    expect(reads()).toBe(1);
});

it("a newer short mute supersedes an older long mute regardless of database order", async () => {
    const now = Date.now();
    const { world } = muteFixture([event("guild-member-ban", "a", now - 10000, 1000), event("guild-member-ban", "a", now - 20000, 600000)]);
    await world.initializeMuteStatus();
    expect(world.isBotMuted("onebot:g", "a")).toBe(false);
});

it("restores whole-group state for its receiving account and preserves a separate member mute", async () => {
    const now = Date.now();
    const { world } = muteFixture([
        event("guild-all-member-ban", undefined, now - 4000, -1000, "a"),
        event("guild-all-member-ban", undefined, now - 4000, -1000, "b"),
        event("guild-member-ban", "a", now - 3000, 60000),
        event("guild-all-member-unban", undefined, now - 2000, undefined, "a"),
        event("guild-member-unban", "a", now - 1000),
    ]);
    await world.initializeMuteStatus();
    expect(world.isBotMuted("onebot:g", "a")).toBe(false);
    expect(world.isBotMuted("onebot:g", "b")).toBe(true);
});

it("restores legacy whole-group records and their old zero-target release", async () => {
    const now = Date.now();
    const { world } = muteFixture([
        event("guild-all-member-ban", undefined, now - 3000, -1000),
        event("guild-member-ban", "a", now - 2000, 60000),
        event("guild-member-unban", undefined, now - 1000),
    ]);
    await world.initializeMuteStatus();
    expect(world.isBotMuted("onebot:g", "a")).toBe(true);
    expect(world.isBotMuted("onebot:g", "b")).toBe(false);
});

function replyFixture() {
    const fixture = muteFixture();
    fixture.ctx[Services.WorldState] = fixture.world;
    fixture.ctx[Services.Model] = { useChatGroup: () => ({}) } as any;
    fixture.ctx[Services.Prompt] = {} as any;
    const core: any = new AgentCore(fixture.ctx, Config({ newMessageStrategy: "immediate" }));
    let sends = 0;
    const session: any = {
        platform: "onebot",
        selfId: "a",
        channelId: "g",
        cid: "onebot:g",
        isDirect: false,
        bot: {
            platform: "onebot",
            selfId: "a",
            sendMessage: async () => {
                sends++;
            },
        },
        resolve: (value: any) => value,
        elements: [],
        stripped: {},
    };
    const stimulus = { type: "system_event", session, channelCid: JSON.stringify(["onebot", "a", "g"]), priority: 8 };
    return { ...fixture, core, stimulus, sends: () => sends };
}

it("checks mute again when a scheduled task begins", async () => {
    const f = replyFixture();
    let cycles = 0;
    f.core.processor.runCycle = async () => {
        cycles++;
        return false;
    };
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    await f.core.scheduler.taskCallback(f.stimulus);
    expect(cycles).toBe(0);
    await f.ctx.stop();
});

it("does not revive a turn muted during asynchronous reply-rule cleanup", async () => {
    const f = replyFixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.core.replyControl.flush = async () => {
        entered();
        await gate;
    };
    let cycles = 0;
    f.core.processor.runCycle = async () => {
        cycles++;
        return false;
    };
    const result = f.core.scheduler.taskCallback(f.stimulus);
    await started;
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    f.world.updateMuteStatus("onebot:g", 0, "a");
    release();
    await result;
    expect(cycles).toBe(0);
    expect(f.core.activeTurns.size).toBe(0);
    await f.ctx.stop();
});

it("aborts an in-flight reply and cannot revive it on immediate unmute", async () => {
    const f = replyFixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let signal: AbortSignal | undefined;
    f.core.processor.runCycle = async (stimulus: any) => {
        signal = replyTurnSignal();
        entered();
        await gate;
        await stimulus.session.bot.sendMessage("g", "old reply");
        return true;
    };
    const result = f.core.scheduler.taskCallback(f.stimulus).then(
        () => undefined,
        (error: Error) => error,
    );
    await started;
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    const aborted = signal?.aborted;
    f.world.updateMuteStatus("onebot:g", 0, "a");
    release();
    await result;
    expect(aborted).toBe(true);
    expect(f.sends()).toBe(0);
    await f.ctx.stop();
});

it("checks the actual destination before a tool sends into another muted group", async () => {
    const f = replyFixture();
    f.world.updateMuteStatus("onebot:other", Date.now() + 60000, "a");
    f.core.processor.runCycle = async (stimulus: any) => {
        await stimulus.session.bot.sendMessage("other", "reply");
        return true;
    };
    await f.core.scheduler.taskCallback(f.stimulus).catch(() => {});
    expect(f.sends()).toBe(0);
    // A normal command still goes through the adapter; platform mute is not chat.pause.
    await f.stimulus.session.bot.sendMessage("g", "ordinary command");
    expect(f.sends()).toBe(1);
    await f.ctx.stop();
});

it("discards pending debounce work so it is not replayed after unmute", async () => {
    const f = replyFixture();
    const queued: Array<() => void> = [];
    f.ctx.debounce = ((callback: Function) => {
        let active = true;
        const invoke: any = (...args: any[]) =>
            queued.push(() => {
                if (active) callback(...args);
            });
        invoke.dispose = () => {
            active = false;
        };
        return invoke;
    }) as any;
    let cycles = 0;
    f.core.processor.runCycle = async () => {
        cycles++;
        return false;
    };
    f.core.scheduler.schedule(f.stimulus);
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    f.world.updateMuteStatus("onebot:g", 0, "a");
    queued[0]();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(cycles).toBe(0);
    await f.ctx.stop();
});

it("does not abort another bot's active turn and permits a fresh turn after unmute", async () => {
    const f = replyFixture();
    let cycles = 0;
    f.core.processor.runCycle = async (stimulus: any) => {
        cycles++;
        f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "b");
        expect(replyTurnSignal()?.aborted).toBe(false);
        await stimulus.session.bot.sendMessage("g", "reply");
        return true;
    };
    await f.core.scheduler.taskCallback(f.stimulus);
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    await f.core.scheduler.taskCallback(f.stimulus);
    f.world.updateMuteStatus("onebot:g", 0, "a");
    await f.core.scheduler.taskCallback(f.stimulus);
    expect(cycles).toBe(2);
    expect(f.sends()).toBe(2);
    await f.ctx.stop();
});

it("skips assessment while muted and discards a pending assessment on mute", async () => {
    const f = replyFixture();
    f.core.config.typesafe = {
        mode: "adjust",
        evaluationModel: { providerName: "test", modelId: "test" },
        interests: "test",
        historyLimit: 0,
        timeoutMs: 1000,
        influence: 0.5,
    };
    const incoming: any = {
        ...f.stimulus,
        type: "user_message",
        session: {
            ...f.stimulus.session,
            userId: "user",
            messageId: "incoming",
            content: "hello",
            toJSON: () => ({ message: { content: "hello" } }),
        },
    };
    let evaluations = 0,
        release!: (value: any) => void;
    let signal: AbortSignal | undefined;
    const response = new Promise((resolve) => {
        release = resolve;
    });
    (f.ctx[Services.Model] as any).getEvaluationModel = () => ({
        evaluate: async (_state: any, _questions: any, abort: AbortSignal) => {
            evaluations++;
            signal = abort;
            return response;
        },
    });
    let scheduled = 0;
    f.core.scheduler.schedule = () => {
        scheduled++;
    };
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    f.core.receiveStimulus(incoming);
    expect(evaluations).toBe(0);
    f.world.updateMuteStatus("onebot:g", 0, "a");
    f.core.receiveStimulus(incoming);
    expect(evaluations).toBe(1);
    f.world.updateMuteStatus("onebot:g", Date.now() + 60000, "a");
    expect(signal?.aborted).toBe(true);
    expect(f.core.pendingAssessments.size).toBe(0);
    f.world.updateMuteStatus("onebot:g", 0, "a");
    release({ answers: { addressed: { noul: 1 }, interested: { noul: 1 }, others: { noul: 0 } } });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(scheduled).toBe(0);
    const target = { platform: "onebot", selfId: "a", channelId: "g" };
    expect(f.core.decisions.latest(target)?.reason).toBe("muted");
    await f.ctx.stop();
});

// Use Koishi's real encoding pipeline without requiring an optional OneBot package.
for (const mode of ["before-send", "chunks", "upload", "explicit-target"] as const) {
    it(`rechecks mute at the adapter boundary after ${mode}`, async () => {
        const f = replyFixture();
        let entered!: () => void, release!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let delivered = 0;
        class Encoder extends MessageEncoder {
            async visit() {}
            async flush() {
                if (mode === "upload") {
                    entered();
                    await gate;
                    await this.bot.internal.uploadGroupFile(this.channelId, "file", "name");
                } else {
                    await this.bot.internal.sendGroupMsg(this.channelId, "first");
                    if (mode === "chunks") await this.bot.internal.sendGroupMsg(this.channelId, "second");
                }
                this.results.push({ id: "sent" });
            }
        }
        class SendingBot extends Bot {
            static MessageEncoder = Encoder;
        }
        const bot: any = Object.create(SendingBot.prototype);
        Object.assign(bot, {
            ctx: f.ctx,
            context: f.ctx,
            config: {},
            platform: "onebot",
            user: { id: "a", name: "bot" },
            callbacks: {},
            logger,
        });
        // Replace the opaque fake OneBot accounts so an explicit target resolves this bot.
        f.ctx.bots.splice(0, 2, bot);
        bot.internal = {
            sendGroupMsg: async () => {
                delivered++;
                if (mode === "chunks" && delivered === 1) {
                    entered();
                    await gate;
                }
            },
            uploadGroupFile: async () => {
                delivered++;
            },
        };
        if (mode === "before-send" || mode === "explicit-target") {
            f.ctx.on("before-send", async () => {
                entered();
                await gate;
            });
        }
        f.stimulus.session = bot.session({ type: "message", channel: { id: "g" }, user: { id: "user" } });
        f.ctx[Services.Asset] = { encode: async (value: string) => value } as any;
        const tool =
            mode === "explicit-target"
                ? new CoreUtilExtension(f.ctx, { typing: { minDelay: 0, maxDelay: 0, baseDelay: 0, charPerSecond: 5 } } as any)
                : undefined;
        f.core.processor.runCycle = async (stimulus: any) => {
            if (mode === "explicit-target") {
                return (await tool!.sendMessage({ session: stimulus.session, target: "onebot:destination", message: "reply" } as any)).status === "success";
            }
            await stimulus.session.bot.sendMessage("g", "reply");
            return true;
        };
        const result = f.core.scheduler.taskCallback(f.stimulus).catch(() => {});
        await started;
        f.world.updateMuteStatus(`onebot:${mode === "explicit-target" ? "destination" : "g"}`, Date.now() + 60000, "a");
        release();
        await result;
        expect(delivered).toBe(mode === "chunks" ? 1 : 0);
        if (mode === "before-send") {
            await bot.sendMessage("g", "ordinary command");
            expect(delivered).toBe(1);
        }
        await f.ctx.stop();
    });
}
