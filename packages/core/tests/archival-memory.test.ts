import { afterEach, expect, it, setSystemTime, spyOn } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HistoryCommandManager } from "../src/services/worldstate/commands";
import { ContextBuilder } from "../src/services/worldstate/context-builder";
import { InteractionManager } from "../src/services/worldstate/interaction-manager";
import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { ArchivalMemoryManager } from "../src/services/worldstate/l3-archival-memory";
import { diaryDayRange } from "../src/services/worldstate/memory-date";
import { Services, TableName } from "../src/shared/constants";

const directories: string[] = [];
afterEach(async () => {
    setSystemTime();
    await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});
const log = { info() {}, debug() {}, warn() {}, error() {} };
const defaultChat = async (_args: any) => ({ text: "diary" });
const noop = async () => {};
const noopWithTable = async (_table: string) => {};
const day = () => new Date(2026, 9, 1, 12);
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const settle = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
};
function matches(row: any, query: any): boolean {
    return Object.entries(query).every(([key, value]: [string, any]) => {
        if (value && typeof value === "object") {
            if (value.$gte !== undefined && row[key] < value.$gte) return false;
            if (value.$lt !== undefined && row[key] >= value.$lt) return false;
            if (value.$regex) return value.$regex.test(row[key]);
            if (value.$not) return !value.$not.$regex.test(row[key]);
            return true;
        }
        return row[key] === value;
    });
}
async function fixture() {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "yib-l3-"));
    directories.push(baseDir);
    const rows = new Map<string, any[]>([TableName.Messages, TableName.SystemEvents, TableName.L2Chunks, TableName.L3Diaries].map((table) => [table, []]));
    const actions = new Map<string, Function>();
    const queries: any[] = [];
    const prompts: any[] = [];
    let chat = defaultChat;
    let beforeCreate = noop;
    let beforeGet = noopWithTable;
    const database = {
        get: async (table: string, query: any) => {
            queries.push({ table, query });
            const snapshot = rows
                .get(table)!
                .filter((row) => matches(row, query))
                .map((row) => ({ ...row }));
            await beforeGet(table);
            return snapshot;
        },
        create: async (table: string, row: any) => {
            await beforeCreate();
            if (rows.get(table)!.some((old) => old.id === row.id)) throw new Error("duplicate id");
            rows.get(table)!.push(row);
            return row;
        },
        remove: async (table: string, query: any) => {
            const old = rows.get(table)!;
            const keep = old.filter((row) => !matches(row, query));
            rows.set(table, keep);
            return { removed: old.length - keep.length };
        },
    };
    const command = (name: string, parent = ""): any => {
        const fullName = name.startsWith(".") ? parent + name : name;
        const instance: any = {
            option: () => instance,
            usage: () => instance,
            example: () => instance,
            subcommand: (child: string) => command(child, fullName),
            action: (fn: Function) => {
                actions.set(fullName, fn);
                return instance;
            },
        };
        return instance;
    };
    const model = {
        chat: async (args: any) => {
            prompts.push(args);
            return chat(args);
        },
    };
    const ctx: any = {
        baseDir,
        database,
        command,
        logger: log,
        [Services.Logger]: { getLogger: () => log },
        [Services.Model]: { useChatGroup: () => ({ getModels: () => [model] }) },
    };
    const config: any = {
        l1_memory: { maxMessages: 50, keepFullTurnCount: 2 },
        l2_memory: { enabled: false },
        l3_memory: { enabled: true, diaryGenerationTime: "04:00" },
    };
    // Keep real log read/write methods without the constructor's detached mkdir.
    const interaction: any = Object.create(InteractionManager.prototype);
    Object.assign(interaction, { ctx, config, logger: log, basePath: path.join(baseDir, "data", "yesimbot", "interactions") });
    const semantic = new SemanticMemoryManager(ctx, config);
    const memory: any = new ArchivalMemoryManager(ctx, config, interaction, semantic);
    memory.chatModel = model;
    const service: any = { l2_manager: semantic, l3_manager: memory, l1_manager: interaction };
    new HistoryCommandManager(ctx, service, config).register();
    const seedMessages = (platform = "onebot", channelId = "same", date = day()) => {
        for (let i = 0; i < 5; i++)
            rows.get(TableName.Messages)!.push({
                id: `${platform}-${channelId}-${i}`,
                platform,
                channelId,
                timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 10, i),
                sender: { id: "user", name: "User" },
                content: `message ${i}`,
            });
    };
    return {
        ctx,
        config,
        rows,
        queries,
        prompts,
        memory,
        semantic,
        interaction,
        seedMessages,
        model: (fn: typeof chat) => {
            chat = fn;
        },
        creating: (fn: typeof beforeCreate) => {
            beforeCreate = fn;
        },
        reading: (fn: typeof beforeGet) => {
            beforeGet = fn;
        },
        diaries: () => rows.get(TableName.L3Diaries)!,
        clear: (options: any = {}) => actions.get("history.clear")!({ session: { platform: "onebot", channelId: "same" }, options }),
    };
}

for (const hour of [4, 12])
    it(`retrieves yesterday's diary only from the current platform at ${hour}:00`, async () => {
        setSystemTime(new Date(2026, 9, 1, hour));
        const f = await fixture();
        for (const platform of ["onebot", "discord"])
            f.diaries().push({ id: platform, platform, channelId: "private:same", date: "2026-09-30", content: platform });
        const builder = new ContextBuilder(f.ctx, f.config, { getL1History: async () => [] } as any, f.semantic, f.memory);
        const result = await builder.build({
            platform: "onebot",
            channelId: "private:same",
            selfId: "bot",
            userId: "user",
            isDirect: true,
            author: { name: "User" },
            bot: { getUser: async (id: string) => ({ id, name: id }) },
        } as any);
        expect(result.l3_diary_entries?.map((entry) => entry.platform)).toEqual(["onebot"]);
    });

it("uses adjacent local midnights across daylight-saving changes", () => {
    const { start, end } = diaryDayRange(new Date(2026, 2, 8, 12));
    expect(start).toEqual(new Date(2026, 2, 8));
    expect(end).toEqual(new Date(2026, 2, 9));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 + (end.getTimezoneOffset() - start.getTimezoneOffset()) * 60000);
});

it("uses a local calendar date and includes the final millisecond of that day", async () => {
    const f = await fixture();
    f.seedMessages();
    const messages = f.rows.get(TableName.Messages)!;
    messages[4].timestamp = new Date(2026, 9, 1, 23, 59, 59, 999);
    await f.memory.generateDiaryForChannel("onebot", "same", new Date(2026, 9, 1, 4));
    expect(f.diaries()).toHaveLength(1);
    expect(f.diaries()[0].date).toBe("2026-10-01");
    expect(f.prompts[0].messages[0].content).toContain("message 4");
    const range = f.queries.find((item) => item.table === TableName.Messages && item.query.timestamp).query.timestamp;
    expect(range.$gte).toEqual(new Date(2026, 9, 1));
    expect(range.$lt).toEqual(new Date(2026, 9, 2));
});

for (const concurrent of [false, true])
    it(`avoids duplicate model calls for the same diary (${concurrent ? "concurrent" : "sequential"})`, async () => {
        const f = await fixture();
        f.seedMessages();
        if (concurrent)
            await Promise.all([f.memory.generateDiaryForChannel("onebot", "same", day()), f.memory.generateDiaryForChannel("onebot", "same", day())]);
        else {
            await f.memory.generateDiaryForChannel("onebot", "same", day());
            await f.memory.generateDiaryForChannel("onebot", "same", day());
        }
        expect(f.prompts).toHaveLength(1);
        expect(f.diaries()).toHaveLength(1);
    });

it("generates database-channel diaries when the agent-log directory is absent", async () => {
    const f = await fixture();
    f.seedMessages();
    await f.memory.generateDiariesForAllChannels(day());
    expect(f.diaries().map((row) => row.channelId)).toEqual(["same"]);
});

for (const channelId of ["private:u", "team_room:thread"])
    it(`keeps the original ID of a channel known only through agent logs (${channelId})`, async () => {
        const f = await fixture();
        setSystemTime(day());
        for (let i = 0; i < 5; i++) await f.interaction.recordAction("turn", "onebot", channelId, { function: "test", params: {} });
        await f.memory.generateDiariesForAllChannels(day());
        expect(f.diaries().map((row) => row.channelId)).toEqual([channelId]);
    });

it("does not generate a second sanitized alias of a database channel", async () => {
    const f = await fixture();
    f.seedMessages("onebot", "private:u");
    setSystemTime(day());
    await f.interaction.recordAction("turn", "onebot", "private:u", { function: "test", params: {} });
    const calls = spyOn(f.memory, "generateDiaryForChannel");
    await f.memory.generateDiariesForAllChannels(day());
    expect(calls.mock.calls.map((args) => args[1])).toEqual(["private:u"]);
});

for (const ambiguous of [false, true])
    it(`reads legacy logs only when the file has a unique known owner (${ambiguous ? "ambiguous" : "unique"})`, async () => {
        const f = await fixture();
        f.seedMessages("onebot", "private:u");
        if (ambiguous) f.seedMessages("onebot", "private_u");
        const directory = path.join(f.ctx.baseDir, "data", "yesimbot", "interactions", "onebot");
        await fs.mkdir(directory, { recursive: true });
        const legacy = {
            type: "agent_action",
            id: "old",
            turnId: "turn",
            timestamp: day().toISOString(),
            function: "PRIVATE_ONLY_SECRET",
            params: {},
        };
        await fs.writeFile(path.join(directory, "private_u.agent.jsonl"), JSON.stringify(legacy) + "\n");
        await f.memory.generateDiariesForAllChannels(day());
        expect(f.prompts).toHaveLength(ambiguous ? 2 : 1);
        for (const prompt of f.prompts) expect(prompt.messages[0].content.includes("PRIVATE_ONLY_SECRET")).toBe(!ambiguous);
    });

it("rejects legacy logs when an agent-only channel shares the sanitized filename", async () => {
    const f = await fixture();
    setSystemTime(day());
    f.seedMessages("onebot", "private:u");
    const directory = path.join(f.ctx.baseDir, "data", "yesimbot", "interactions", "onebot");
    await fs.mkdir(directory, { recursive: true });
    const legacy = {
        type: "agent_action",
        id: "old",
        turnId: "turn",
        timestamp: day().toISOString(),
        function: "AMBIGUOUS_LEGACY_SECRET",
        params: {},
    };
    await fs.writeFile(path.join(directory, "private_u.agent.jsonl"), JSON.stringify(legacy) + "\n");
    for (let i = 0; i < 5; i++) await f.interaction.recordAction("turn", "onebot", "private_u", { function: "GUILD_ONLY_SECRET", params: {} });

    await f.memory.generateDiariesForAllChannels(day());

    expect(f.diaries().map((row) => row.channelId)).toEqual(["private:u", "private_u"]);
    expect(f.prompts).toHaveLength(2);
    for (const prompt of f.prompts) expect(prompt.messages[0].content).not.toContain("AMBIGUOUS_LEGACY_SECRET");
    expect(f.prompts[0].messages[0].content).not.toContain("GUILD_ONLY_SECRET");
    expect(f.prompts[1].messages[0].content).toContain("GUILD_ONLY_SECRET");
});

it("filters source identities when new log records share the same sanitized filename", async () => {
    const f = await fixture();
    setSystemTime(day());
    f.seedMessages("onebot", "private:u");
    f.seedMessages("onebot", "private_u");
    await f.interaction.recordAction("turn", "onebot", "private:u", { function: "PRIVATE_ONLY_SECRET", params: {} });
    await f.interaction.recordAction("turn", "onebot", "private_u", { function: "GUILD_ONLY_SECRET", params: {} });
    await f.memory.generateDiariesForAllChannels(day());
    expect(f.prompts).toHaveLength(2);
    expect(f.prompts[0].messages[0].content).toContain("PRIVATE_ONLY_SECRET");
    expect(f.prompts[0].messages[0].content).not.toContain("GUILD_ONLY_SECRET");
    expect(f.prompts[1].messages[0].content).toContain("GUILD_ONLY_SECRET");
    expect(f.prompts[1].messages[0].content).not.toContain("PRIVATE_ONLY_SECRET");
});

it("does not save a pending model response after stop", async () => {
    const f = await fixture();
    f.seedMessages();
    const entered = deferred(),
        response = deferred<{ text: string }>();
    f.model(async () => {
        entered.resolve();
        return response.promise;
    });
    const running = f.memory.generateDiaryForChannel("onebot", "same", day());
    await entered.promise;
    const stopping = f.memory.stop();
    response.resolve({ text: "stale" });
    await Promise.all([running, stopping]);
    expect(f.diaries()).toEqual([]);
});

it("clears L3 diaries by the same platform and channel scope as L1/L2", async () => {
    const f = await fixture();
    f.diaries().push({ id: "old", platform: "onebot", channelId: "same" }, { id: "keep", platform: "discord", channelId: "same" });
    expect(await f.clear()).toContain("操作成功");
    expect(f.diaries().map((row) => row.id)).toEqual(["keep"]);
});

for (const type of ["private", "guild", "all"])
    it(`clears L3 diaries with -a ${type}`, async () => {
        const f = await fixture();
        f.diaries().push({ id: "p", platform: "onebot", channelId: "private:u" }, { id: "g", platform: "discord", channelId: "group" });
        await f.clear({ all: type });
        expect(f.diaries().map((row) => row.id)).toEqual(type === "private" ? ["g"] : type === "guild" ? ["p"] : []);
    });

it("does not recreate cleared history from an old model response", async () => {
    const f = await fixture();
    f.seedMessages();
    const entered = deferred(),
        response = deferred<{ text: string }>();
    f.model(async () => {
        entered.resolve();
        return response.promise;
    });
    const running = f.memory.generateDiaryForChannel("onebot", "same", day());
    await entered.promise;
    await f.clear();
    response.resolve({ text: "stale" });
    await running;
    expect(f.diaries()).toEqual([]);
});

it("invalidates an interaction snapshot read before clear but returned afterwards", async () => {
    const f = await fixture();
    f.seedMessages();
    const entered = deferred(),
        read = deferred();
    f.reading(async (table) => {
        if (table === TableName.Messages) {
            entered.resolve();
            await read.promise;
        }
    });
    const running = f.memory.generateDiaryForChannel("onebot", "same", day());
    await entered.promise;
    await f.clear();
    read.resolve();
    await running;
    expect(f.prompts).toEqual([]);
    expect(f.diaries()).toEqual([]);
});

it("leaves an unrelated platform's pending diary valid after a scoped clear", async () => {
    const f = await fixture();
    f.seedMessages();
    f.seedMessages("discord");
    const entered = deferred(),
        response = deferred<{ text: string }>();
    let calls = 0;
    f.model(async () => {
        if (++calls === 2) entered.resolve();
        return response.promise;
    });
    const running = [f.memory.generateDiaryForChannel("onebot", "same", day()), f.memory.generateDiaryForChannel("discord", "same", day())];
    await entered.promise;
    await f.clear();
    response.resolve({ text: "diary" });
    await Promise.all(running);
    expect(f.diaries().map((row) => row.platform)).toEqual(["discord"]);
});

it("waits for log deletion before a fresh diary can read history", async () => {
    const f = await fixture();
    setSystemTime(day());
    for (let i = 0; i < 5; i++) await f.interaction.recordAction("turn", "onebot", "same", { function: "old", params: {} });
    const entered = deferred(),
        deleting = deferred();
    const remove = f.interaction.clearAgentHistory.bind(f.interaction);
    f.interaction.clearAgentHistory = async (...args: any[]) => {
        entered.resolve();
        await deleting.promise;
        return remove(...args);
    };
    const clearing = f.clear();
    await entered.promise;
    const fresh = f.memory.generateDiaryForChannel("onebot", "same", day());
    await settle();
    const callsDuringClear = f.prompts.length;
    deleting.resolve();
    await Promise.all([clearing, fresh]);
    expect(callsDuringClear).toBe(0);
    expect(f.prompts).toEqual([]);
    expect(f.diaries()).toEqual([]);
});

it("cannot revive an old model response when the diary service restarts", async () => {
    const f = await fixture();
    f.seedMessages();
    const entered = deferred(),
        response = deferred<{ text: string }>();
    f.model(async () => {
        entered.resolve();
        return response.promise;
    });
    const old = f.memory.generateDiaryForChannel("onebot", "same", day());
    await entered.promise;
    await f.memory.stop();
    f.memory.start();
    try {
        f.model(async () => ({ text: "fresh" }));
        await f.memory.generateDiaryForChannel("onebot", "same", day());
        response.resolve({ text: "stale" });
        await old;
        expect(f.diaries().map((row) => row.content)).toEqual(["fresh"]);
    } finally {
        response.resolve({ text: "stale" });
        await f.memory.stop();
    }
});

it("waits for a diary write already issued before deleting history", async () => {
    const f = await fixture();
    f.seedMessages();
    const entered = deferred(),
        write = deferred();
    f.creating(async () => {
        entered.resolve();
        await write.promise;
    });
    const running = f.memory.generateDiaryForChannel("onebot", "same", day());
    await entered.promise;
    let cleared = false;
    const clearing = f.clear().then(() => {
        cleared = true;
    });
    await settle();
    const finishedEarly = cleared;
    write.resolve();
    await Promise.all([running, clearing]);
    expect(finishedEarly).toBe(false);
    expect(f.diaries()).toEqual([]);
});

it("waits for an issued diary database write during stop", async () => {
    const f = await fixture();
    f.seedMessages();
    const entered = deferred(),
        write = deferred();
    f.creating(async () => {
        entered.resolve();
        await write.promise;
    });
    const running = f.memory.generateDiaryForChannel("onebot", "same", day());
    await entered.promise;
    let stopped = false;
    const stopping = Promise.resolve(f.memory.stop()).then(() => {
        stopped = true;
    });
    await settle();
    const finishedEarly = stopped;
    write.resolve();
    await Promise.all([running, stopping]);
    expect(finishedEarly).toBe(false);
});

it("schedules the previous completed local day and handles exact scheduled times", async () => {
    const f = await fixture();
    setSystemTime(new Date(2026, 8, 30, 23, 30));
    const tasks: Array<{ callback: Function; delay: number }> = [];
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: Function, delay: number) => {
        tasks.push({ callback, delay });
        return {};
    }) as any);
    const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    const dates: Date[] = [];
    f.memory.generateDiariesForAllChannels = async (date: Date) => {
        dates.push(date);
    };
    try {
        f.memory.start();
        expect(tasks[0].delay).toBe(4.5 * 60 * 60 * 1000);
        setSystemTime(new Date(2026, 9, 1, 4));
        tasks[0].callback();
        await settle();
        expect(dates).toEqual([new Date(2026, 8, 30)]);
        expect(tasks[1].delay).toBeGreaterThan(0);
        await f.memory.stop();
    } finally {
        timer.mockRestore();
        clear.mockRestore();
    }
});

it("does not create a hot timer loop for an invalid diary time", async () => {
    const f = await fixture();
    f.config.l3_memory.diaryGenerationTime = "99:99";
    let scheduled = 0;
    const timer = spyOn(globalThis, "setTimeout").mockImplementation((() => {
        scheduled++;
        return {};
    }) as any);
    const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    try {
        f.memory.start();
        expect(scheduled).toBe(0);
        await f.memory.stop();
    } finally {
        timer.mockRestore();
        clear.mockRestore();
    }
});
