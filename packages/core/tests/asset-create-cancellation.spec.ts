import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { AssetService } from "../src/asset/service";
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
}
function fixture() {
    const files = new Map<string, Buffer>();
    const rows = new Map<string, any>();
    const storage = {
        write: vi.fn<(...args: any[]) => Promise<any>>(async (id: string, data: Buffer) => {
            files.set(id, data);
        }),
        delete: vi.fn<(...args: any[]) => Promise<any>>(async (id: string) => {
            files.delete(id);
        }),
    };
    const database = {
        get: vi.fn<(...args: any[]) => Promise<any>>(async (_table: any, query: any) => [...rows.values()].filter((row) => row.hash === query.hash)),
        upsert: vi.fn<(...args: any[]) => Promise<any>>(async (_table: any, data: any[]) => {
            for (const row of data) rows.set(row.id, row);
        }),
        remove: vi.fn<(...args: any[]) => Promise<any>>(async (_table: any, query: any) => {
            rows.delete(query.id);
        }),
    };
    const service = Object.create(AssetService.prototype);
    Object.assign(service, {
        storage,
        ctx: { database },
        logger: { info() {}, warn() {} },
        _getSourceBuffer: vi.fn<(...args: any[]) => Promise<any>>(async () => ({ data: Buffer.from("hello"), type: "text/plain" })),
        _updateLastUsed: vi.fn<(...args: any[]) => Promise<any>>(async () => {}),
    });
    return { service: service as AssetService, storage, database, rows, files };
}
it("rejects an already aborted asset creation before reading its source", async () => {
    const f = fixture();
    const turn = new AbortController();
    turn.abort(new Error("cancelled"));
    await expect(f.service.create("source", {}, { signal: turn.signal } as any)).rejects.toThrow("cancelled");
    expect((f.service as any)._getSourceBuffer).not.toHaveBeenCalled();
});
it.each(["write", "commit"])("rolls back an owned new asset cancelled during %s", async (boundary) => {
    const f = fixture();
    const turn = new AbortController();
    const entered = deferred(),
        blocked = deferred();
    const operation = boundary === "write" ? f.storage.write : f.database.upsert;
    const original = operation.getMockImplementation()!;
    operation.mockImplementation(async (...args: any[]) => {
        await (original as any)(...args);
        entered.resolve();
        await blocked.promise;
    });
    const creation = f.service.create("source", {}, { signal: turn.signal } as any);
    await entered.promise;
    turn.abort(new Error("cancelled"));
    blocked.resolve();
    await expect(creation).rejects.toThrow("cancelled");
    expect(f.rows.size).toBe(0);
    expect(f.files.size).toBe(0);
});
it("removes a new asset when the database commits and then throws", async () => {
    const f = fixture();
    const original = f.database.upsert.getMockImplementation()!;
    const failure = new Error("commit acknowledgement lost");
    f.database.upsert.mockImplementation(async (...args: any[]) => {
        await (original as any)(...args);
        throw failure;
    });
    await expect(f.service.create("source", {}, { signal: new AbortController().signal } as any)).rejects.toBe(failure);
    expect(f.rows.size).toBe(0);
    expect(f.files.size).toBe(0);
});
it("does not delete a preexisting deduplicated asset on cancellation", async () => {
    const f = fixture();
    const turn = new AbortController();
    const existing = { id: "original", hash: createHash("sha256").update("hello").digest("hex") };
    f.rows.set(existing.id, existing);
    f.files.set(existing.id, Buffer.from("hello"));
    (f.service as any)._updateLastUsed.mockImplementation(async () => turn.abort(new Error("cancelled")));
    await expect(f.service.create("source", {}, { signal: turn.signal } as any)).rejects.toThrow("cancelled");
    expect(f.rows.get("original")).toBe(existing);
    expect(f.files.get("original")?.toString()).toBe("hello");
    expect(f.storage.delete).not.toHaveBeenCalled();
    expect(f.database.remove).not.toHaveBeenCalled();
});
it("rejects cancellable replacement IDs without touching the original", async () => {
    const f = fixture();
    f.files.set("original", Buffer.from("original"));
    await expect(f.service.create("source", {}, { id: "original", signal: new AbortController().signal } as any)).rejects.toThrow(/signal.*id|id.*signal/i);
    expect(f.files.get("original")?.toString()).toBe("original");
    expect(f.storage.write).not.toHaveBeenCalled();
});
it("reports incomplete rollback while preserving the original failure", async () => {
    const f = fixture();
    const original = new Error("database failed"),
        cleanup = new Error("disk unavailable");
    f.database.upsert.mockRejectedValue(original);
    f.storage.delete.mockRejectedValue(cleanup);
    const error = await f.service.create("source", {}, { signal: new AbortController().signal } as any).catch((error) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(original);
    expect(error.errors).toContain(cleanup);
});
it("preserves custom IDs without a cancellation signal", async () => {
    const f = fixture();
    expect(await f.service.create("source", {}, { id: "custom" })).toBe("custom");
    expect(f.rows.has("custom")).toBe(true);
});

it.each(["row", "file"])("attempts both cleanups when %s cleanup throws synchronously", async (boundary) => {
    const f = fixture();
    const original = new Error("database failed"),
        cleanup = new Error("cleanup failed");
    const upsert = f.database.upsert.getMockImplementation()!;
    f.database.upsert.mockImplementation(async (...args: any[]) => {
        await upsert(...args);
        throw original;
    });
    const failing = boundary === "row" ? f.database.remove : f.storage.delete;
    failing.mockImplementation(() => {
        throw cleanup;
    });
    const error = await f.service.create("source", {}, { signal: new AbortController().signal }).catch((error) => error);
    expect(f.storage.delete).toHaveBeenCalled();
    expect(f.database.remove).toHaveBeenCalled();
    expect(f.files.size).toBe(boundary === "row" ? 0 : 1);
    expect(f.rows.size).toBe(boundary === "row" ? 1 : 0);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(original);
    expect(error.errors).toContain(cleanup);
});

it("advertises immutable cancellable asset creation support", () => {
    const f = fixture();
    expect(f.service.capabilities).toEqual({ cancellableCreate: 1 });
    expect(Object.isFrozen(f.service.capabilities)).toBe(true);
});
