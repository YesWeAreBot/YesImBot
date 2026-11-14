import { expect, it } from "vitest";

import { WorldStateService } from "../../core/src/world/service";
import { DailyPlannerService } from "../src/service";

function fixture() {
    const rows: any[] = [];
    let allowed = true;
    let directSearches = 0,
        recalls = 0;
    const db = {
        get: async (table, query) =>
            rows.filter((r) => r.table === table && Object.entries(query).every(([k, v]) => r[k] === v)).map(({ table: _table, ...r }) => structuredClone(r)),
        upsert: async (table, input) => {
            for (const row of input) {
                const old = rows.find((r) => r.table === table && r.date === row.date && r.instance === row.instance);
                if (old) Object.assign(old, structuredClone(row));
                else rows.push({ table, ...structuredClone(row) });
            }
        },
    };
    const make = (key: string, options: { chat?: () => Promise<void>; realRecall?: boolean } = {}) => {
        const bot = {
            platform: "onebot",
            selfId: "bot",
            session: (e) => ({ ...e, platform: "onebot", selfId: "bot", channelId: e.channel.id, userId: e.user.id, isDirect: e.channel.type === 1 }),
        };
        const ctx: any = {
            scope: { key },
            get: () => undefined,
            bots: [bot],
            filter: () => true,
            on() {},
            model: { extend() {} },
            logger: { info() {}, debug() {}, warn() {}, error() {} },
            database: db,
        };
        let prompt = "";
        const snippets = new Map<string, any>();
        ctx.yesimbot = {
            memory: { getMemoryBlocksForRendering: () => [] },
            prompt: {
                registerSnippet: (name, render) => {
                    snippets.set(name, render);
                    return () => snippets.delete(name);
                },
            },
            model: {
                useChatModel: () => ({
                    chat: async (request) => {
                        prompt = JSON.stringify(request);
                        await options.chat?.();
                        return { text: JSON.stringify([{ start: "08:00", end: "09:00", content: key }]) };
                    },
                }),
                getChatModel: () => ({
                    chat: async (request) => {
                        prompt = JSON.stringify(request);
                        await options.chat?.();
                        return { text: JSON.stringify([{ start: "08:00", end: "09:00", content: key }]) };
                    },
                }),
            },
            world: {
                isChannelAllowed: () => allowed,
                recallContext: async (session, options) => {
                    recalls++;
                    expect(session.channelId).toBe("hidden");
                    expect(options.kind).toBe("l2");
                    return { historyGeneration: 0, records: [{ id: "old", content: "PRIVATE-MEMORY" }] };
                },
                l2_manager: {
                    getHistoryGeneration: () => 0,
                    search: async () => {
                        directSearches++;
                        return [{ id: "old", content: "PRIVATE-MEMORY" }];
                    },
                },
            },
        };
        if (options.realRecall) {
            const world = Object.create(WorldStateService.prototype);
            world.ctx = {
                database: db,
                filter: () => true,
                parallel: async (_s, _event, _session, state) => {
                    state.l2_retrieved_memories = state.l2_retrieved_memories.filter((r) => !r.content.includes("CORRECTED"));
                },
            };
            world.l2_manager = { waitForHistoryClear: async () => {}, getHistoryGeneration: () => 0 };
            world.isChannelAllowed = () => allowed;
            ctx.yesimbot.world = world;
        }
        const config: any = { characterName: key, coreMemoryLabel: [], model: { providerName: "p", modelId: "m" }, memorySources: [] };
        return { service: new DailyPlannerService(ctx, config), ctx, config, prompt: () => prompt, snippets };
    };
    return {
        make,
        rows,
        revoke: () => {
            allowed = false;
        },
        stats: () => ({ recalls, directSearches }),
    };
}
it("keeps independent schedules and never adopts unowned legacy date rows", async () => {
    const f = fixture(),
        a = f.make("a"),
        b = f.make("b");
    const d = new Date(),
        date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    f.rows.push({ table: "yesimbot.daily_schedules", date, segments: [{ start: "08:00", end: "09:00", content: "LEGACY" }] });
    await a.service.generateDailySchedule();
    expect((await b.service.getTodaysSchedule()).segments[0].content).toBe("b");
    expect((await a.service.getTodaysSchedule()).segments[0].content).toBe("a");
    expect(f.rows.some((r) => r.segments[0].content === "LEGACY")).toBe(true);
});
it("defaults to core-only planning and revalidates explicitly allowed memory before reuse", async () => {
    const f = fixture(),
        a = f.make("a");
    await a.service.generateDailySchedule();
    expect(f.stats()).toEqual({ recalls: 0, directSearches: 0 });
    a.config.memorySources = [{ platform: "onebot", selfId: "bot", channelId: "hidden", userId: "alice", isDirect: false }];
    await a.service.generateDailySchedule();
    expect(a.prompt()).toContain("PRIVATE-MEMORY");
    f.revoke();
    await a.service.getTodaysSchedule();
    expect(a.prompt()).not.toContain("PRIVATE-MEMORY");
    expect(f.stats().directSearches).toBe(0);
});

it("rejects a model result if permission is revoked while generation is suspended", async () => {
    const f = fixture();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => {
            entered = r;
        }),
        gate = new Promise<void>((r) => {
            release = r;
        });
    const a = f.make("a", {
        chat: async () => {
            entered();
            await gate;
        },
    });
    a.config.memorySources = [{ platform: "onebot", selfId: "bot", channelId: "hidden", userId: "alice", isDirect: false }];
    const pending = a.service.generateDailySchedule();
    await started;
    expect(a.prompt()).toContain("PRIVATE-MEMORY");
    f.revoke();
    release();
    await expect(pending).rejects.toThrow(/权限已改变/);
    expect(f.rows).toEqual([]);
});
it("uses the actual world recall authorization/filter chain and renders only current plans", async () => {
    const f = fixture(),
        a = f.make("a", { realRecall: true });
    a.config.memorySources = [{ platform: "onebot", selfId: "bot", channelId: "hidden", userId: "alice", isDirect: false }];
    // The raw recall selects only this authorized channel; correction filtering then
    // removes the superseded summary before the real model request is constructed.
    f.rows.push(
        { table: "worldstate.l2_chunks", id: "safe", platform: "onebot", channelId: "hidden", content: "ALLOWED-CURRENT" },
        { table: "worldstate.l2_chunks", id: "wrong", platform: "onebot", channelId: "hidden", content: "CORRECTED-OLD" },
        { table: "worldstate.l2_chunks", id: "foreign", platform: "onebot", channelId: "other", content: "FOREIGN-PRIVATE" },
    );
    const render = a.snippets.get("agent.context.dailySchedule");
    expect(await render()).toContain("a");
    expect(a.prompt()).toContain("ALLOWED-CURRENT");
    expect(a.prompt()).not.toContain("CORRECTED-OLD");
    expect(a.prompt()).not.toContain("FOREIGN-PRIVATE");
    f.revoke();
    await render();
    expect(a.prompt()).not.toContain("ALLOWED-CURRENT");
});
it("isolates simultaneous generation and restores only the same stable instance", async () => {
    const f = fixture(),
        a = f.make("a"),
        b = f.make("b");
    await Promise.all([a.service.generateDailySchedule(), b.service.generateDailySchedule()]);
    const restarted = f.make("a");
    expect((await restarted.service.getTodaysSchedule()).segments[0].content).toBe("a");
    expect((await b.service.getTodaysSchedule()).segments[0].content).toBe("b");
    expect(f.rows).toHaveLength(2);
});

it("discards a generated plan when a source is corrected during the model call", async () => {
    const f = fixture();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => {
            entered = r;
        }),
        gate = new Promise<void>((r) => {
            release = r;
        });
    const a = f.make("a", {
        realRecall: true,
        chat: async () => {
            entered();
            await gate;
        },
    });
    a.config.memorySources = [{ platform: "onebot", selfId: "bot", channelId: "hidden", userId: "alice", isDirect: false }];
    const row = { table: "worldstate.l2_chunks", id: "wrong", platform: "onebot", channelId: "hidden", content: "OLD-SOURCE" };
    f.rows.push(row);
    const pending = a.service.generateDailySchedule();
    await started;
    row.content = "CORRECTED-SOURCE";
    release();
    await expect(pending).rejects.toThrow(/权限已改变/);
    expect(f.rows.filter((r) => r.table === "yesimbot.daily_schedules_v2")).toEqual([]);
});

for (const change of ["world permission", "extension permission", "source configuration", "history generation", "session binding"]) {
    it(`rejects the cached plan when earlier source ${change} changes while a later source is suspended`, async () => {
        const f = fixture(),
            a = f.make("a");
        a.config.memorySources = ["A", "B"].map((channelId) => ({ platform: "onebot", selfId: "bot", channelId, userId: "alice", isDirect: false }));
        let allowedA = true,
            extensionAllowedA = true,
            generationA = 0,
            suspended = false;
        let release!: () => void, entered!: () => void, sourceA: any;
        const reached = new Promise<void>((r) => {
                entered = r;
            }),
            gate = new Promise<void>((r) => {
                release = r;
            });
        a.ctx.filter = (session) => session.channelId !== "A" || extensionAllowedA;
        a.ctx.yesimbot.world = {
            isChannelAllowed: (session) => session.channelId !== "A" || allowedA,
            l2_manager: { getHistoryGeneration: (target) => (target.channelId === "A" ? generationA : 0) },
            recallContext: async (session) => {
                if (session.channelId === "A") sourceA = session;
                if (session.channelId === "B" && suspended) {
                    entered();
                    await gate;
                }
                return {
                    historyGeneration: session.channelId === "A" ? generationA : 0,
                    records: [{ id: session.channelId, content: `PRIVATE-${session.channelId}` }],
                };
            },
        };
        await a.service.generateDailySchedule();
        const saved = structuredClone(f.rows);
        suspended = true;
        const pending = a.snippets.get("agent.context.dailySchedule")();
        await reached;
        if (change === "world permission") allowedA = false;
        if (change === "extension permission") extensionAllowedA = false;
        if (change === "source configuration") a.config.memorySources = a.config.memorySources.slice(1);
        if (change === "history generation") generationA++;
        if (change === "session binding") sourceA.userId = "other";
        release();
        await expect(pending).rejects.toThrow(/日程来源.*改变/);
        expect(f.rows).toEqual(saved);
    });
}
