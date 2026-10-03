import { expect, it } from "bun:test";
import { HistoryCommandManager } from "../src/services/worldstate/commands";
import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { Services, TableName } from "../src/shared/constants";
import { MessageData, MemoryChunkData } from "../src/services/worldstate/types";

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function message(content: string, platform = "onebot", channelId = "same"): MessageData {
    return { id: content, platform, channelId, content, sender: { id: "user", name: "User" }, timestamp: new Date(1000) };
}
function matches(row: any, query: any): boolean {
    return Object.entries(query).every(([key, value]: [string, any]) => {
        if (value?.$regex) return value.$regex.test(row[key]);
        if (value?.$not) return !value.$not.$regex.test(row[key]);
        return row[key] === value;
    });
}
function fixture(chunkSize = 2) {
    const rows = new Map<string, any[]>([
        [TableName.Messages, []],
        [TableName.SystemEvents, []],
        [TableName.L2Chunks, []],
        [TableName.L3Diaries, []],
    ]);
    const actions = new Map<string, any>();
    const operations: string[] = [];
    const log = { info() {}, debug() {}, warn() {}, error() {} };
    let embed = async (_text: string) => ({ embedding: [1, 0] });
    let beforeCreate = async () => {};
    let beforeSet = async () => {};
    let beforeGet = async () => {};
    const database = {
        get: async (table: string, query: any) => {
            const snapshot = rows
                .get(table)!
                .filter((row) => matches(row, query))
                .map((row) => ({ ...row }));
            await beforeGet();
            return snapshot;
        },
        create: async (table: string, row: any) => {
            await beforeCreate();
            rows.get(table)!.push(row);
            return row;
        },
        set: async (table: string, query: any, value: any) => {
            await beforeSet();
            rows.get(table)!
                .filter((row) => matches(row, query))
                .forEach((row) => Object.assign(row, value));
            operations.push(`set:${query.id}`);
        },
        remove: async (table: string, query: any) => {
            operations.push(`remove:${table}`);
            const old = rows.get(table)!;
            const remaining = old.filter((row) => !matches(row, query));
            rows.set(table, remaining);
            return { removed: old.length - remaining.length };
        },
    };
    const command = (name: string, parent = ""): any => {
        const fullName = name.startsWith(".") ? parent + name : name;
        const instance: any = {
            option: () => instance,
            usage: () => instance,
            example: () => instance,
            subcommand: (child: string) => command(child, fullName),
            action: (action: any) => {
                actions.set(fullName, action);
                return instance;
            },
        };
        return instance;
    };
    const ctx: any = {
        database,
        logger: log,
        command,
        [Services.Logger]: { getLogger: () => log },
        [Services.Model]: { useEmbeddingGroup: () => ({ getModels: () => [{ embed: (text: string) => embed(text) }] }) },
    };
    const config: any = { l2_memory: { enabled: true, messagesPerChunk: chunkSize }, l1_memory: { maxMessages: 10 } };
    const memory = new SemanticMemoryManager(ctx, config);
    memory.start();
    new HistoryCommandManager(ctx, { l2_manager: memory, l1_manager: { clearAgentHistory: async () => {} } } as any, config).register();
    return {
        memory,
        rows,
        operations,
        clear: (options: any = {}) => actions.get("history.clear")({ session: { platform: "onebot", channelId: "same" }, options }),
        embedding: (fn: typeof embed) => {
            embed = fn;
        },
        creating: (fn: typeof beforeCreate) => {
            beforeCreate = fn;
        },
        setting: (fn: typeof beforeSet) => {
            beforeSet = fn;
        },
        reading: (fn: typeof beforeGet) => {
            beforeGet = fn;
        },
        chunks: () => rows.get(TableName.L2Chunks)! as MemoryChunkData[],
    };
}
// Catch omitted buffer invalidation through all existing target selectors.
for (const options of [{}, { platform: "onebot", channel: "same" }, { target: "onebot:same" }, { channel: "same" }]) {
    it(`clears buffered history through the real command (${JSON.stringify(options)})`, async () => {
        const f = fixture();
        f.rows.get(TableName.Messages)!.push(message("old"));
        await f.memory.addMessageToBuffer(message("old"));
        expect(await f.clear(options)).toContain("操作成功");
        await f.memory.addMessageToBuffer(message("new-1"));
        await f.memory.addMessageToBuffer(message("new-2"));
        expect(f.chunks().map((chunk) => chunk.content)).toEqual(["User: new-1\nUser: new-2"]);
    });
}
it("isolates a target from the same channel ID on another platform", async () => {
    const f = fixture();
    await f.memory.addMessageToBuffer(message("old"));
    await f.memory.addMessageToBuffer(message("keep", "discord"));
    await f.clear({ target: "onebot:same" });
    await f.memory.addMessageToBuffer(message("keep-next", "discord"));
    expect(f.chunks().map((chunk) => [chunk.platform, chunk.content])).toEqual([["discord", "User: keep\nUser: keep-next"]]);
});
it("does not resurrect a batch whose embedding was pending when clear succeeded", async () => {
    const f = fixture(1),
        entered = deferred(),
        embedding = deferred<{ embedding: number[] }>();
    f.embedding(async () => {
        entered.resolve();
        return embedding.promise;
    });
    const old = f.memory.addMessageToBuffer(message("old"));
    await entered.promise;
    expect(await f.clear()).toContain("操作成功");
    embedding.resolve({ embedding: [1, 0] });
    await old;
    expect(f.chunks()).toEqual([]);
});
it("waits for an issued create before deletion and preserves messages arriving during clear", async () => {
    const f = fixture(1),
        entered = deferred(),
        writing = deferred();
    f.creating(async () => {
        entered.resolve();
        await writing.promise;
    });
    const old = f.memory.addMessageToBuffer(message("old"));
    await entered.promise;
    const clearing = f.clear();
    const fresh = f.memory.addMessageToBuffer(message("fresh"));
    writing.resolve();
    await Promise.all([old, clearing, fresh]);
    expect(f.chunks().map((chunk) => chunk.content)).toEqual(["User: fresh"]);
});
it("preserves new messages arriving during a flush", async () => {
    const f = fixture(5),
        entered = deferred(),
        embedding = deferred<{ embedding: number[] }>();
    await f.memory.addMessageToBuffer(message("first"));
    f.embedding(async () => {
        entered.resolve();
        return embedding.promise;
    });
    const flushing = f.memory.flushBuffer("same");
    await entered.promise;
    await f.memory.addMessageToBuffer(message("next"));
    embedding.resolve({ embedding: [1, 0] });
    await flushing;
    await f.memory.flushBuffer("same");
    expect(f.chunks().map((chunk) => chunk.content)).toEqual(["User: first", "User: next"]);
});
for (const type of ["private", "guild", "all"]) {
    it(`applies -a ${type} to stored and buffered messages on all platforms`, async () => {
        const f = fixture(5);
        const old = [message("p", "onebot", "private:u"), message("g", "onebot", "group"), message("other", "discord", "private:u")];
        f.rows.get(TableName.Messages)!.push(...old);
        for (const value of old) await f.memory.addMessageToBuffer(value);
        await f.clear({ all: type, platform: "onebot" });
        await f.memory.flushBuffer("private:u");
        await f.memory.flushBuffer("group");
        const want = type === "private" ? ["g"] : type === "guild" ? ["p", "other"] : [];
        expect(
            f.rows
                .get(TableName.Messages)!
                .map((row) => row.content)
                .sort()
        ).toEqual([...want].sort());
        expect(
            f
                .chunks()
                .map((chunk) => chunk.content)
                .sort()
        ).toEqual(want.map((text) => `User: ${text}`).sort());
    });
}
function seedChunk(f: ReturnType<typeof fixture>) {
    f.rows.get(TableName.L2Chunks)!.push({
        id: "old",
        platform: "onebot",
        channelId: "same",
        content: "old",
        embedding: [0],
        participantIds: ["user"],
        startTimestamp: new Date(1000),
        endTimestamp: new Date(1000),
    });
}
it("does not issue an old rebuild write after a clear during embedding", async () => {
    const f = fixture(),
        entered = deferred(),
        embedding = deferred<{ embedding: number[] }>();
    seedChunk(f);
    f.embedding(async () => {
        entered.resolve();
        return embedding.promise;
    });
    const rebuilding = f.memory.rebuildIndex();
    await entered.promise;
    await f.clear();
    seedChunk(f); // Reused ID exposes an old rebuild touching a newer row.
    embedding.resolve({ embedding: [9, 9] });
    await rebuilding;
    expect(f.chunks()[0].embedding).toEqual([0]);
});
it("invalidates a rebuild snapshot captured before clear but returned afterwards", async () => {
    const f = fixture(),
        entered = deferred(),
        reading = deferred();
    seedChunk(f);
    f.reading(async () => {
        entered.resolve();
        await reading.promise;
    });
    const rebuilding = f.memory.rebuildIndex();
    await entered.promise;
    await f.clear();
    seedChunk(f);
    reading.resolve();
    await rebuilding;
    expect(f.chunks()[0].embedding).toEqual([0]);
});
it("waits for a rebuild database update already in progress before reporting success", async () => {
    const f = fixture(),
        entered = deferred(),
        writing = deferred();
    seedChunk(f);
    f.setting(async () => {
        entered.resolve();
        await writing.promise;
    });
    const rebuilding = f.memory.rebuildIndex();
    await entered.promise;
    const clearing = f.clear();
    writing.resolve();
    await Promise.all([rebuilding, clearing]);
    expect(f.operations).toEqual([
        `set:old`,
        `remove:${TableName.Messages}`,
        `remove:${TableName.SystemEvents}`,
        `remove:${TableName.L2Chunks}`,
        `remove:${TableName.L3Diaries}`,
    ]);
    expect(f.chunks()).toEqual([]);
});

// Scope generations must invalidate only the matching in-flight embeddings.
for (const type of ["private", "guild", "all"]) {
    it(`cancels only embeddings selected by -a ${type}`, async () => {
        const f = fixture(1);
        const pEntered = deferred(),
            gEntered = deferred();
        const pEmbedding = deferred<{ embedding: number[] }>(),
            gEmbedding = deferred<{ embedding: number[] }>();
        f.embedding(async (text) => {
            if (text === "User: private") {
                pEntered.resolve();
                return pEmbedding.promise;
            }
            gEntered.resolve();
            return gEmbedding.promise;
        });
        const privateWork = f.memory.addMessageToBuffer(message("private", "onebot", "private:u"));
        const guildWork = f.memory.addMessageToBuffer(message("guild", "discord", "group"));
        await Promise.all([pEntered.promise, gEntered.promise]);
        await f.clear({ all: type });
        pEmbedding.resolve({ embedding: [1, 0] });
        gEmbedding.resolve({ embedding: [1, 0] });
        await Promise.all([privateWork, guildWork]);
        const want = type === "private" ? ["User: guild"] : type === "guild" ? ["User: private"] : [];
        expect(f.chunks().map((chunk) => chunk.content)).toEqual(want);
    });
}
it("keeps sub-threshold new buffers when deletion waits for an older create", async () => {
    const f = fixture(2),
        entered = deferred(),
        writing = deferred();
    f.creating(async () => {
        entered.resolve();
        await writing.promise;
    });
    await f.memory.addMessageToBuffer(message("old-1"));
    const old = f.memory.addMessageToBuffer(message("old-2"));
    await entered.promise;
    const clearing = f.clear();
    await f.memory.addMessageToBuffer(message("fresh-1"));
    writing.resolve();
    await Promise.all([old, clearing]);
    await f.memory.addMessageToBuffer(message("fresh-2"));
    expect(f.chunks().map((chunk) => chunk.content)).toEqual(["User: fresh-1\nUser: fresh-2"]);
});
it("supports multiple explicit targets with colons in their channel IDs", async () => {
    const f = fixture(5);
    await f.memory.addMessageToBuffer(message("erase-private", "onebot", "private:u"));
    await f.memory.addMessageToBuffer(message("erase-group", "discord", "group"));
    await f.memory.addMessageToBuffer(message("keep", "discord", "private:u"));
    await f.clear({ target: "onebot:private:u,discord:group" });
    await f.memory.flushBuffer("private:u");
    await f.memory.flushBuffer("group");
    expect(f.chunks().map((chunk) => [chunk.platform, chunk.content])).toEqual([["discord", "User: keep"]]);
});
it("holds overlapping clears until issued writes finish and preserves messages after the latest clear", async () => {
    const f = fixture(1),
        entered = deferred(),
        writing = deferred();
    f.creating(async () => {
        entered.resolve();
        await writing.promise;
    });
    const old = f.memory.addMessageToBuffer(message("old"));
    await entered.promise;
    const firstClear = f.clear();
    const between = f.memory.addMessageToBuffer(message("between"));
    const secondClear = f.clear({ all: "all" });
    const newest = f.memory.addMessageToBuffer(message("newest"));
    writing.resolve();
    await Promise.all([old, firstClear, between, secondClear, newest]);
    expect(f.chunks().map((chunk) => chunk.content)).toEqual(["User: newest"]);
});
it("does not wait for a database write belonging to an unrelated target", async () => {
    const f = fixture(1),
        entered = deferred(),
        writing = deferred();
    f.creating(async () => {
        entered.resolve();
        await writing.promise;
    });
    const other = f.memory.addMessageToBuffer(message("keep", "discord"));
    await entered.promise;
    const clearResult = await f.clear({ target: "onebot:same" });
    writing.resolve();
    await other;
    expect(clearResult).toContain("操作成功");
    expect(f.chunks().map((chunk) => [chunk.platform, chunk.content])).toEqual([["discord", "User: keep"]]);
});
