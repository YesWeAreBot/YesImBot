import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { Bot, Context } from "koishi";
import { expect, it, vi } from "vitest";

import { AgentCore } from "../src/agent/agent-core";
import { DecisionRecords } from "../src/agent/decision-record";
import { ReplyControl } from "../src/agent/reply-control";
import { WillingnessManager } from "../src/agent/willing";
import { Config } from "../src/config";
import { EventListenerManager } from "../src/services/worldstate/event-listener";
import { WorldStateService } from "../src/services/worldstate/service";
import { Services } from "../src/shared/constants";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
async function fixture() {
    const ctx = new Context();
    const command: any = new Proxy({}, { get: () => () => command });
    Object.defineProperty(ctx, "command", { value: () => command });
    ctx[Services.Logger] = { getLogger: () => logger } as any;
    ctx[Services.Asset] = { transform: async (content: string) => content } as any;
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, { ctx, platform: "onebot", user: { id: "bot", name: "bot" } });
    const session = bot.session({
        type: "message",
        channel: { id: "allowed", type: 0 },
        user: { id: "alice", name: "Alice" },
        message: { id: "m1", content: "hello" },
    });
    session.content = "hello";
    const cores: any[] = [];
    async function addCore(scope: Context = ctx, channel = "allowed") {
        const world: any = Object.create(WorldStateService.prototype);
        world.stimulusOwnerId = randomUUID();
        world.config = { allowedChannels: [{ platform: "onebot", type: "guild", id: channel }] };
        world.observeChannel = async () => {};
        world.recordMessage = async () => {};
        world.isBotMuted = () => false;
        world.peekBotMuted = () => false;
        const config = Config({ base: { text: 100 }, lifecycle: { probabilityThreshold: 0 }, typesafe: { mode: "off" } });
        const core: any = Object.create(AgentCore.prototype);
        const scheduled: any[] = [];
        Object.defineProperty(core, "ctx", { value: scope });
        Object.defineProperty(core, "logger", { value: logger });
        Object.assign(core, {
            config,
            worldState: world,
            stopped: false,
            decisions: new DecisionRecords(),
            pendingAssessments: new Map(),
            activeTurns: new Map(),
            activeDecisionIds: new Map(),
            topicScores: new Map(),
            willing: new WillingnessManager(scope, config),
            scheduler: { noteUserMessage() {}, isBusy: () => false, schedule: (s: any) => scheduled.push(s), dispose() {}, cancel() {} },
            promptService: { registerTemplate() {}, registerSnippet() {} },
            replyControl: new ReplyControl(
                { load: async () => [], save: async () => {}, remove: async () => {} },
                () => {},
                async () => {},
            ),
        });
        await core.start();
        cores.push(core);
        return { core, world, scheduled };
    }
    async function emitUser(world: any) {
        const manager: any = new EventListenerManager(ctx, world, {} as any);
        const initial = new Set(ctx.$processor._hooks);
        manager.start();
        try {
            const hook = ctx.$processor._hooks.find((hook: any) => !initial.has(hook))!;
            await hook.callback(session, async () => undefined);
        } finally {
            manager.stop();
        }
    }
    async function stop() {
        for (const core of cores) await core.stop();
        await ctx.stop();
    }
    return { ctx, session, addCore, emitUser, stop };
}
it("each instance processes only its own core-generated user stimulus", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const f = await fixture();
    try {
        const a = await f.addCore();
        const b = await f.addCore();
        await f.emitUser(a.world);
        expect(a.scheduled).toHaveLength(1);
        expect(b.scheduled).toHaveLength(0);
        expect(b.core.decisions.latest({ platform: "onebot", selfId: "bot", channelId: "allowed" })).toBeUndefined();
        await f.emitUser(b.world);
        expect(a.scheduled).toHaveLength(1);
        expect(b.scheduled).toHaveLength(1);
    } finally {
        random.mockRestore();
        await f.stop();
    }
});
it("core event dispatch preserves Koishi session filters", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const f = await fixture();
    try {
        const owner = await f.addCore();
        let unrelated = 0;
        f.ctx.channel("blocked").on("agent/stimulus", () => {
            unrelated++;
        });
        await f.emitUser(owner.world);
        expect(owner.scheduled).toHaveLength(1);
        expect(unrelated).toBe(0);
    } finally {
        random.mockRestore();
        await f.stop();
    }
});
it("legacy unowned events still require the receiving instance channel permission", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const f = await fixture();
    try {
        const allowed = await f.addCore();
        const blocked = await f.addCore(f.ctx, "blocked");
        await f.ctx.parallel("agent/stimulus", {
            type: "scheduled_task",
            session: f.session,
            channelCid: f.session.cid,
            priority: 5,
            payload: { messageIds: ["m1"] },
        });
        expect(allowed.scheduled).toHaveLength(1);
        expect(blocked.scheduled).toHaveLength(0);
        expect(blocked.core.decisions.latest({ platform: "onebot", selfId: "bot", channelId: "allowed" })).toBeUndefined();
    } finally {
        random.mockRestore();
        await f.stop();
    }
});
it("legacy unowned events also require the receiving Koishi filter", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const f = await fixture();
    try {
        const blocked = await f.addCore(f.ctx.channel("blocked"));
        await f.ctx.parallel("agent/stimulus", {
            type: "scheduled_task",
            session: f.session,
            channelCid: f.session.cid,
            priority: 5,
            payload: { messageIds: ["m1"] },
        });
        expect(blocked.scheduled).toHaveLength(0);
    } finally {
        random.mockRestore();
        await f.stop();
    }
});
it("system wakeups after a bot unmute also stay with their source instance", async () => {
    const f = await fixture();
    try {
        const a = await f.addCore();
        const b = await f.addCore();
        a.world.updateMuteStatus = async () => {};
        a.world.recordSystemEvent = async () => true;
        f.session.event.subtype = "ban";
        f.session.event.user = { id: "bot" };
        f.session.event._data = { user_id: "bot", duration: 0, sub_type: "lift_ban" };
        const manager: any = new EventListenerManager(f.ctx, a.world, {} as any);
        await manager.handleGuildMember(f.session);
        expect(a.scheduled).toHaveLength(1);
        expect(b.scheduled).toHaveLength(0);
        expect(a.core.decisions.latest({ platform: "onebot", selfId: "bot", channelId: "allowed" })?.stimulusType).toBe("system_event");
    } finally {
        await f.stop();
    }
});
it("a replacement instance rejects an old instance owner token", async () => {
    const f = await fixture();
    try {
        const replacement = await f.addCore();
        await f.ctx.parallel(
            f.session,
            "agent/stimulus",
            { type: "scheduled_task", session: f.session, channelCid: f.session.cid, priority: 5, payload: {} },
            randomUUID(),
        );
        expect(replacement.scheduled).toHaveLength(0);
        expect(replacement.core.decisions.latest({ platform: "onebot", selfId: "bot", channelId: "allowed" })).toBeUndefined();
        await f.ctx.parallel(
            f.session,
            "agent/stimulus",
            { type: "scheduled_task", session: f.session, channelCid: f.session.cid, priority: 5, payload: {} },
            replacement.world.stimulusOwnerId,
        );
        expect(replacement.scheduled).toHaveLength(1);
    } finally {
        await f.stop();
    }
});
it("an unowned extension event cannot bypass the configured Bot filter", async () => {
    const f = await fixture();
    try {
        const otherBot = await f.addCore(f.ctx.self("another-bot"));
        await f.ctx.parallel("agent/stimulus", { type: "scheduled_task", session: f.session, channelCid: f.session.cid, priority: 5, payload: {} });
        expect(otherBot.scheduled).toHaveLength(0);
    } finally {
        await f.stop();
    }
});
it("actual WorldState owners retain identity across service proxies and change on replacement", async () => {
    const f = await fixture();
    f.ctx.baseDir = tmpdir();
    try {
        const config = Config({ l2_memory: { enabled: false }, l3_memory: { enabled: false } });
        const original = new WorldStateService(f.ctx, config);
        f.ctx[Services.WorldState] = original;
        const first = f.ctx[Services.WorldState];
        const other = f.ctx.channel("allowed")[Services.WorldState];
        expect(first).not.toBe(other);
        expect(first.stimulusOwnerId).toBe(original.stimulusOwnerId);
        expect(other.stimulusOwnerId).toBe(original.stimulusOwnerId);
        const replacement = new WorldStateService(f.ctx, config);
        expect(replacement.stimulusOwnerId).not.toBe(original.stimulusOwnerId);
    } finally {
        await f.stop();
    }
});
