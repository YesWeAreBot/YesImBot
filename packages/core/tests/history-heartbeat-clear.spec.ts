import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Bot, Context, MessageEncoder, Schema } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { guardReplySession, withReplyTurn } from "../src/agent/reply-turn";
import { HISTORY_CHANNELS } from "../src/world/channel-metadata";
import { InteractionManager } from "../src/world/interaction-manager";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";
import { stubCtx } from "./helpers/yesimbot";
const target = { platform: "qq", channelId: "room", selfId: "bot", channelType: "guild" as const };
const log = { info() {}, warn() {}, error() {}, debug() {} };
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { resolve, promise };
}
async function fixture(embed = async () => ({ embedding: [1] })) {
    const app = new Context();
    app.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx: app });
    await app.start();
    await app.database.prepared();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audit-history-"));
    onTestFinished(async () => {
        await app.stop();
        await fs.rm(root, { recursive: true, force: true });
    });
    await app.database.create(HISTORY_CHANNELS, { platform: "qq", channelId: "room", channelType: "guild" });
    const ctx = stubCtx(
        { logging: { getLogger: () => log }, model: { useEmbeddingGroup: () => ({ getModels: () => [{ embed }] }) } },
        { database: app.database, baseDir: root, scope: { key: "audit" } },
    );
    const config: any = { l2_memory: { enabled: true, messagesPerChunk: 2 }, dataRetentionDays: 1 };
    const l1_manager = new InteractionManager(ctx, config, ctx.yesimbot.logging);
    const l2_manager = new SemanticMemoryManager(ctx, config, ctx.yesimbot.logging, ctx.yesimbot.model);
    l2_manager.start();
    return { app, ctx, config, l1_manager, l2_manager };
}

for (const mode of ["normal", "streaming", "native"])
    for (const scope of ["channel", "guild", "all"])
        it(`clearing ${scope} across managers aborts late ${mode} heartbeat without logs or send`, async () => {
            const f = await fixture(),
                entered = deferred(),
                hold = deferred();
            const sent: string[] = [];
            let signal: AbortSignal | undefined;
            (log as any).success = () => {};
            f.l2_manager.observeChannel(target, "guild");
            const other = new SemanticMemoryManager(f.ctx, f.config, f.ctx.yesimbot.logging, f.ctx.yesimbot.model);
            const processor = new HeartbeatProcessor(f.ctx, { heartbeat: 2, nativeToolCalling: mode === "native", streamAction: mode === "streaming" } as any, {
                model: {
                    chat: async (options: any) => {
                        signal = options.abortSignal;
                        entered.resolve();
                        await hold.promise;
                        return {
                            text: JSON.stringify({
                                thoughts: { observe: "secret before clear", analyze_infer: "secret before clear", plan: "repeat secret" },
                                actions: [{ function: "send_message", params: { message: "old-context reply" } }],
                                request_heartbeat: true,
                            }),
                        };
                    },
                } as any,
                prompt: {} as any,
                tool: {
                    getAvailableTools: () => [{ name: "send_message", description: "send", parameters: Schema.object({}) }],
                    invoke: async (_name: string, params: any, session: any) => {
                        await session.bot.sendMessage("room", params.message);
                        return { status: "success" };
                    },
                } as any,
                l1: f.l1_manager,
                contextBuilder: {} as any,
                logging: f.ctx.yesimbot.logging as any,
                world: { l2_manager: f.l2_manager } as any,
            });
            (processor as any)._prepareLlmRequest = async () => ({ messages: [{ role: "user", content: "secret before clear" }], manualRecallIds: [] });
            const bot = {
                platform: "onebot",
                selfId: "bot",
                sendMessage: async (_channel: string, text: string) => {
                    sent.push(text);
                },
            };
            const running = withReplyTurn(
                () => true,
                () => processor.runCycle({ session: { ...target, bot, cid: "qq:room" } } as any),
            );
            await entered.promise;
            await other.clearHistory(scope === "channel" ? target : { type: scope as "guild" | "all" }, () => f.l1_manager.clearAgentHistory("qq", "room"));
            const aborted = signal?.aborted;
            hold.resolve();
            expect(await running).toBe(false);
            expect(aborted).toBe(true);
            expect(await f.l1_manager.getL1History("qq", "room", 20)).toEqual([]);
            expect(sent).toEqual([]);
        });
it("clear blocks a send resumed inside an already-running tool and its observation", async () => {
    const f = await fixture(),
        entered = deferred(),
        hold = deferred();
    const sent: string[] = [];
    (log as any).success = () => {};
    const processor = new HeartbeatProcessor(f.ctx, { heartbeat: 1 } as any, {
        model: {
            chat: async () => ({
                text: JSON.stringify({ thoughts: { observe: "old" }, actions: [{ function: "send_message", params: {} }], request_heartbeat: false }),
            }),
        } as any,
        prompt: {} as any,
        tool: {
            invoke: async (_name: string, _params: any, session: any) => {
                entered.resolve();
                await hold.promise;
                await session.bot.sendMessage("room", "old");
                return { status: "success", result: "old" };
            },
        } as any,
        l1: f.l1_manager,
        contextBuilder: {} as any,
        logging: f.ctx.yesimbot.logging as any,
        world: { l2_manager: f.l2_manager } as any,
    });
    (processor as any)._prepareLlmRequest = async () => ({ messages: [], manualRecallIds: [] });
    const bot = {
        platform: "onebot",
        selfId: "bot",
        sendMessage: async () => {
            sent.push("sent");
        },
    };
    const running = withReplyTurn(
        () => true,
        () => processor.runCycle({ session: { ...target, bot, cid: "qq:room" } } as any),
    );
    await entered.promise;
    await f.l2_manager.clearHistory(target, () => f.l1_manager.clearAgentHistory("qq", "room"));
    hold.resolve();
    expect(await running).toBe(false);
    expect(sent).toEqual([]);
    expect(await f.l1_manager.getL1History("qq", "room", 20)).toEqual([]);
});
for (const kind of ["thought", "action", "observation", "heartbeat"])
    it(`clear rejects a queued ${kind} write after channel metadata lookup resumes`, async () => {
        const f = await fixture(),
            entered = deferred(),
            hold = deferred();
        let blocked = false;
        const database = {
            get: async (...args: any[]) => {
                if (!blocked) {
                    blocked = true;
                    entered.resolve();
                    await hold.promise;
                }
                return (f.app.database.get as any)(...args);
            },
        };
        const ctx = stubCtx({ logging: { getLogger: () => log } }, { database, baseDir: (f.ctx as any).baseDir, scope: { key: "audit" } });
        const manager = new InteractionManager(ctx, {} as any, ctx.yesimbot.logging);
        const { withReplyTurnGuard } = await import("../src/agent/reply-turn");
        const controller = new AbortController();
        const unwatch = f.l2_manager.watchHistory(target, () => controller.abort());
        const writing = withReplyTurnGuard(
            () => true,
            () => {
                if (kind === "thought") return manager.recordThought("old", "qq", "room", { observe: "old", analyze_infer: "old", plan: "old" });
                if (kind === "action") return manager.recordAction("old", "qq", "room", { function: "send_message", params: { message: "old" } });
                if (kind === "observation")
                    return manager.recordObservation("old", "qq", "room", { turnId: "old", function: "probe", status: "success", result: "old" });
                return manager.recordHeartbeat("old", "qq", "room", 1, 2);
            },
            controller.signal,
        );
        void writing.catch(() => {});
        await entered.promise;
        const clearing = f.l2_manager.clearHistory(target, () => f.l1_manager.clearAgentHistory("qq", "room"));
        hold.resolve();
        await expect(writing).rejects.toThrow("聊天任务已取消");
        await clearing;
        unwatch();
        expect(await f.l1_manager.getL1History("qq", "room", 20)).toEqual([]);
    });

it("history clear stops a delayed generic encoder through the AgentCore and heartbeat session guards", async () => {
    const f = await fixture(),
        entered = deferred(),
        hold = deferred();
    const sent: string[] = [];
    class Encoder extends MessageEncoder {
        async visit() {}
        async flush() {
            entered.resolve();
            await hold.promise;
            await this.bot.internal.sendGroupMsg(this.channelId, "old");
            this.results.push({ id: "sent" });
        }
    }
    class SendingBot extends Bot {
        static MessageEncoder = Encoder;
    }
    const bot: any = Object.create(SendingBot.prototype);
    Object.assign(bot, {
        ctx: f.app,
        context: f.app,
        config: {},
        platform: "discord",
        user: { id: "bot" },
        callbacks: {},
        internal: { sendGroupMsg: async () => sent.push("old") },
    });
    const processor = new HeartbeatProcessor(f.ctx, { heartbeat: 1 } as any, {
        model: {
            chat: async () => ({
                text: JSON.stringify({ thoughts: { observe: "old" }, actions: [{ function: "send_message", params: {} }], request_heartbeat: false }),
            }),
        } as any,
        prompt: {} as any,
        tool: {
            invoke: async (_name: string, _params: any, session: any) => {
                await session.bot.sendMessage("room", "old");
                return { status: "success" };
            },
        } as any,
        l1: f.l1_manager,
        contextBuilder: {} as any,
        logging: f.ctx.yesimbot.logging as any,
        world: { l2_manager: f.l2_manager } as any,
    });
    (processor as any)._prepareLlmRequest = async () => ({ messages: [], manualRecallIds: [] });
    const running = withReplyTurn(
        () => true,
        () =>
            processor.runCycle({
                session: guardReplySession({ ...target, bot, cid: "qq:room" } as any),
            } as any),
        new AbortController().signal,
    );
    await entered.promise;
    await f.l2_manager.clearHistory(target, () => f.l1_manager.clearAgentHistory("qq", "room"));
    hold.resolve();
    expect(await running).toBe(false);
    expect(sent).toEqual([]);
    expect(await f.l1_manager.getL1History("qq", "room", 20)).toEqual([]);
});
