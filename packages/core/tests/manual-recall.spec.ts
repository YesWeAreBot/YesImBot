import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Context, Bot, Schema } from "koishi";
import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ContextBuilder } from "../src/world/context-builder";
import { InteractionManager } from "../src/world/interaction-manager";
import { WorldStateService } from "../src/world/service";
import { loggingStub } from "./helpers/yesimbot";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
function session(app: Context, channelId = "private:alice") {
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, { ctx: app, platform: "onebot", user: { id: "bot", name: "Bot" } });
    return bot.session({ type: "message", channel: { id: channelId, type: 1 }, user: { id: "alice", name: "Alice" }, message: { id: "m" } });
}

for (const operation of ["buildWorldState", "recallContext"] as const) {
    it(`${operation} applies each listener's channel filter to the actual Session`, async () => {
        const app = new Context();
        const incoming = session(app);
        const received: string[] = [];
        app.channel("public").on("yesimbot/filter-recalled-memory", (_session, state) => {
            received.push("outside");
        });
        app.channel(incoming.channelId).on("yesimbot/filter-recalled-memory", (_session, state) => {
            received.push(state.l2_retrieved_memories[0].content);
        });
        const row = {
            id: "memory",
            platform: incoming.platform,
            channelId: incoming.channelId,
            content: "private text",
            startTimestamp: new Date(),
            endTimestamp: new Date(),
            participantIds: ["alice"],
        };
        app.set("database", { get: async () => [row] } as any);
        const world = Object.create(WorldStateService.prototype);
        Object.assign(world, {
            ctx: app,
            config: { allowedChannels: [{ platform: "onebot", type: "private", id: "*" }] },
            l2_manager: { getHistoryGeneration: () => 0 },
            contextBuilder: { build: async () => ({ l2_retrieved_memories: [row], l3_diary_entries: [] }) },
        });
        try {
            expect(app.channel("public").filter(incoming)).toBe(false);
            if (operation === "buildWorldState") await world.buildWorldState(incoming);
            else await world.recallContext(incoming, { kind: "l2" });
            expect(received).toEqual(["private text"]);
        } finally {
            await app.stop();
        }
    });
}

async function fixture() {
    const baseDir = await mkdtemp(path.join(tmpdir(), "manual-recall-"));
    const app = new Context({ baseDir });
    app.baseDir = baseDir;
    app.set("yesimbot", { logging: { getLogger: () => logger } });
    app.set("database", { get: async () => [] } as any);
    const config: any = { l1_memory: { maxMessages: 2, keepFullTurnCount: 2 }, l2_memory: { enabled: false }, l3_memory: { enabled: false } };
    const manager = new InteractionManager(app, config, loggingStub(logger));
    const world = Object.create(WorldStateService.prototype);
    Object.assign(world, {
        ctx: app,
        config: { allowedChannels: [{ platform: "onebot", type: "private", id: "*" }] },
        l1_manager: manager,
        l2_manager: {
            writeMemory: async (_target: any, _generation: any, write: () => Promise<void>) => {
                await write();
                return true;
            },
        },
    });
    const incoming = session(app);
    const builder = new ContextBuilder(app, config, manager, {} as any, {} as any, loggingStub(logger));
    (builder as any).getSelfInfo = async () => ({ id: "bot", name: "Bot" });
    (builder as any).getChannelInfo = async () => ({ name: "Alice" });
    return {
        app,
        manager,
        world,
        incoming,
        builder,
        close: async () => {
            await app.stop();
            await rm(baseDir, { recursive: true, force: true });
        },
    };
}

it("keeps every unconsumed manual page across the L1 event limit and process reload", async () => {
    const f = await fixture();
    try {
        for (let offset = 0; offset < 3; offset++)
            await f.world.injectRecall(f.incoming, { kind: "l3", historyGeneration: 0, records: [{ content: `page-${offset}` }] });
        const reopened = new InteractionManager(f.app, (f.builder as any).config, loggingStub(logger));
        const events = await reopened.getL1History(f.incoming.platform, f.incoming.channelId, 2, "bot");
        const retained = (f.builder as any).applyGracefulDegradation(events);
        expect(retained.map((event: any) => event.result.records[0].content)).toEqual(["page-0", "page-1", "page-2"]);
        const state = await f.builder.build(f.incoming);
        expect(state.l1_working_memory.new_events.filter((event: any) => event.type === "agent_observation")).toHaveLength(3);
    } finally {
        await f.close();
    }
});

it("ignores malformed persisted consumption metadata without losing valid log rows", async () => {
    const f = await fixture();
    try {
        await f.world.injectRecall(f.incoming, { kind: "l3", historyGeneration: 0, records: [{ content: "valid-page" }] });
        const filename = (f.manager as any).getLogFilePath("onebot", f.incoming.channelId);
        await appendFile(
            filename,
            JSON.stringify({
                type: "agent_thought",
                platform: "onebot",
                channelId: f.incoming.channelId,
                id: "invalid-metadata",
                turnId: "broken",
                timestamp: new Date().toISOString(),
                thoughts: {},
                consumedRecallIds: {},
            }) + "\n",
        );
        const history = await f.manager.getL1History("onebot", f.incoming.channelId, 20, "bot");
        expect(history.filter((event: any) => event.type === "agent_observation").map((event: any) => event.result.records[0].content)).toEqual(["valid-page"]);
    } finally {
        await f.close();
    }
});

it("does not let pending manual pages evict completed Agent turns", async () => {
    const f = await fixture();
    try {
        await f.manager.recordThought("turn-1", "onebot", f.incoming.channelId, { observe: "old", analyze_infer: "", plan: "" });
        await f.manager.recordThought("turn-2", "onebot", f.incoming.channelId, { observe: "recent", analyze_infer: "", plan: "" });
        for (let page = 0; page < 3; page++)
            await f.world.injectRecall(f.incoming, { kind: "l3", historyGeneration: 0, records: [{ content: `page-${page}` }] });
        const events = await f.manager.getL1History("onebot", f.incoming.channelId, 20, "bot");
        const retained = (f.builder as any).applyGracefulDegradation(events);
        expect(retained.filter((event: any) => event.type === "agent_thought").map((event: any) => event.turnId)).toEqual(["turn-1", "turn-2"]);
        expect(retained.filter((event: any) => event.type === "agent_observation")).toHaveLength(3);
    } finally {
        await f.close();
    }
});

it("retains consumed manual pages with their first consuming turn and expires them normally", async () => {
    const f = await fixture();
    try {
        for (let page = 0; page < 3; page++)
            await f.world.injectRecall(f.incoming, { kind: "l3", historyGeneration: 0, records: [{ content: `page-${page}` }] });
        const consumed = (await f.manager.getL1History("onebot", f.incoming.channelId, 20, "bot")).map((event: any) => event.turnId);
        await (f.manager.recordThought as any)("consumer", "onebot", f.incoming.channelId, { observe: "read pages", analyze_infer: "", plan: "" }, consumed);
        await f.manager.recordThought("next", "onebot", f.incoming.channelId, { observe: "next", analyze_infer: "", plan: "" });
        const recent = (f.builder as any).applyGracefulDegradation(await f.manager.getL1History("onebot", f.incoming.channelId, 20, "bot"));
        expect(recent.filter((event: any) => event.type === "agent_observation")).toHaveLength(3);
        await f.manager.recordAction("last", "onebot", f.incoming.channelId, { function: "lookup", params: {} });
        const expired = (f.builder as any).applyGracefulDegradation(await f.manager.getL1History("onebot", f.incoming.channelId, 20, "bot"));
        expect(expired.filter((event: any) => event.type === "agent_observation")).toHaveLength(0);
        expect(expired.filter((event: any) => event.type === "agent_thought" || event.type === "agent_action").map((event: any) => event.turnId)).toEqual([
            "next",
            "last",
        ]);
    } finally {
        await f.close();
    }
});

for (const mode of ["json", "stream", "native", "native-tools"]) {
    it(`${mode} consumes only the manual pages included in its request snapshot`, async () => {
        const f = await fixture();
        try {
            await f.world.injectRecall(f.incoming, { kind: "l3", historyGeneration: 0, records: [{ content: "requested-page" }] });
            const definition = { name: "lookup", parameters: Schema.object({}) };
            const processor = new HeartbeatProcessor(
                f.app,
                { heartbeat: 1, nativeToolCalling: mode.startsWith("native"), streamAction: mode === "stream" } as any,
                {
                    model: {
                        chat: async () => {
                            // Arrives while this model request is in flight, after context preparation.
                            await f.world.injectRecall(f.incoming, { kind: "l3", historyGeneration: 0, records: [{ content: "next-page" }] });
                            return mode === "native-tools"
                                ? { toolCalls: [{ toolName: "lookup", toolCallId: "call", args: "{}" }] }
                                : { text: JSON.stringify({ thoughts: {}, actions: [], request_heartbeat: false }) };
                        },
                    } as any,
                    prompt: { render: async () => "prompt" } as any,
                    tool: { getAvailableTools: () => [definition], getTool: () => definition, invoke: async () => ({ status: "success" }) } as any,
                    l1: f.manager,
                    contextBuilder: {
                        build: async () => ({ toolSchemas: [], memoryBlocks: [], worldState: await f.builder.build(f.incoming) }),
                        buildMultimodalUserMessage: async () => "prompt",
                    } as any,
                    logging: loggingStub(logger),
                    world: f.world,
                },
            );
            await processor.runCycle({ session: f.incoming } as any);
            await f.manager.recordThought("next", "onebot", f.incoming.channelId, { observe: "", analyze_infer: "", plan: "" });
            await f.manager.recordThought("last", "onebot", f.incoming.channelId, { observe: "", analyze_infer: "", plan: "" });
            const retained = (f.builder as any).applyGracefulDegradation(await f.manager.getL1History("onebot", f.incoming.channelId, 20, "bot"));
            expect(retained.filter((event: any) => event.type === "agent_observation").map((event: any) => event.result.records[0].content)).toEqual([
                "next-page",
            ]);
        } finally {
            await f.close();
        }
    });
}
