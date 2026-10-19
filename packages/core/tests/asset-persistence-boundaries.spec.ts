import { mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import memory from "@koishijs/plugin-database-memory";
import { Context, h } from "koishi";
import { expect, it, onTestFinished, vi } from "vitest";

import { AssetService } from "../src/asset/service";
import { Config } from "../src/config";
import { TableName } from "../src/shared/constants";
import { loggingStub } from "./helpers/yesimbot";

function deferred() {
    let resolve!: () => void;
    return { promise: new Promise<void>((r) => (resolve = r)), resolve: () => resolve() };
}

const LIMIT = 1024 * 1024;

async function fixture(maxBytes = LIMIT) {
    const baseDir = await mkdtemp(path.join(tmpdir(), "asset-boundaries-"));
    const ctx = new Context({ baseDir });
    ctx.plugin(memory);
    const config = Config({
        maxFileSize: maxBytes / 1024 / 1024,
        storagePath: path.join(baseDir, "assets"),
        image: { processedCachePath: path.join(baseDir, "processed") },
        autoClear: { enabled: false },
        recoveryEnabled: true,
    });
    const assets = new AssetService(ctx, config, loggingStub());
    onTestFinished(async () => {
        await ctx.stop();
        await rm(baseDir, { recursive: true, force: true });
    });
    await ctx.start();
    await assets.start();
    return { ctx, config, assets, baseDir };
}

for (const kind of ["buffer", "data", "file", "http-missing-head", "http-small-head", "http-failed-head"]) {
    it(`rejects an oversized ${kind} body before writing metadata or a resource file`, async () => {
        const f = await fixture();
        const body = Buffer.alloc(LIMIT + 1, 65);
        let source: string | Buffer = body;
        if (kind === "data") source = `data:text/plain;base64,${body.toString("base64")}`;
        if (kind === "file") {
            const file = path.join(f.baseDir, "input");
            await writeFile(file, body);
            source = pathToFileURL(file).href;
        }
        if (kind.startsWith("http")) {
            f.ctx.set("http", {
                head: async () => {
                    if (kind === "http-failed-head") throw new Error("HEAD unsupported");
                    return new Headers(kind === "http-small-head" ? { "content-length": "1" } : {});
                },
                file: async () => ({ type: "text/plain", data: body }),
            } as any);
            source = "https://assets.test/file";
        }
        await expect(f.assets.create(source)).rejects.toThrow(/超出限制/);
        expect(await f.ctx.database.get(TableName.Assets, {})).toEqual([]);
        expect(await readdir(f.config.storagePath)).toEqual([]);
    });
}

it("accepts a body exactly equal to the configured size limit", async () => {
    const f = await fixture();
    const body = Buffer.alloc(LIMIT, 65);
    const id = await f.assets.create(body);
    expect(await f.assets.read(id)).toEqual(body);
    expect(await f.assets.getInfo(id)).toMatchObject({ size: LIMIT });
});

it("rejects oversized recovery content without recreating the missing resource file", async () => {
    const f = await fixture();
    const source = "https://assets.test/recovery";
    let body = Buffer.from("valid");
    f.ctx.set("http", { head: async () => new Headers(), file: async () => ({ type: "text/plain", data: body }) } as any);
    const id = await f.assets.create(source, { src: source });
    await unlink(path.join(f.config.storagePath, id));
    body = Buffer.alloc(LIMIT + 1, 65);
    await expect(f.assets.read(id)).rejects.toThrow(/超出限制/);
    expect(await readdir(f.config.storagePath)).toEqual([]);
    expect(await f.ctx.database.get(TableName.Assets, {})).toMatchObject([{ id, size: 5 }]);
});

it("uses the persisted canonical ID when asynchronous transformation sees an existing hash after service reconstruction", async () => {
    const f = await fixture();
    const source = "data:text/plain;base64,aGVsbG8=";
    const id = await f.assets.create(source);
    const reopened = new AssetService(f.ctx, f.config, loggingStub());
    await reopened.start();
    const result = h.parse(await reopened.transformAsync([h("audio", { src: source })]));
    expect(result[0].attrs.id).toBe(id);
    expect(await reopened.read(result[0].attrs.id)).toEqual(Buffer.from("hello"));
    expect(await f.ctx.database.get(TableName.Assets, {})).toHaveLength(1);
});

it("publishes one stable ID during concurrent create and asynchronous transformations while persistence is pending", async () => {
    const f = await fixture();
    const source = "data:text/plain;base64,aGVsbG8=";
    const entered = deferred(),
        release = deferred();
    const storage = (f.assets as any).storage;
    const write = storage.write.bind(storage);
    const writing = vi.spyOn(storage, "write").mockImplementation(async (...args: any[]) => {
        entered.resolve();
        await release.promise;
        return write(...args);
    });
    const created = f.assets.create(source);
    await entered.promise;
    const transforms = Promise.all(Array.from({ length: 4 }, () => f.assets.transformAsync([h("audio", { src: source })])));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        // The canonical ID is ready before the background write is released.
        const messages = await Promise.race([
            transforms,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("canonical IDs waited for background persistence")), 2000);
            }),
        ]);
        const ids = messages.map((message) => h.parse(message)[0].attrs.id);
        expect(new Set(ids).size).toBe(1);
        release.resolve();
        const id = await created;
        expect(ids).toEqual(Array.from({ length: 4 }, () => id));
        expect(writing).toHaveBeenCalledTimes(1);
        expect(await f.ctx.database.get(TableName.Assets, {})).toMatchObject([{ id }]);
        expect(await readdir(f.config.storagePath)).toEqual([id]);
        expect(await f.assets.read(id)).toEqual(Buffer.from("hello"));
    } finally {
        clearTimeout(timeout);
        release.resolve();
        await created.catch(() => {});
        await transforms;
    }
});

it("does not publish a cancellable owner's ID before its rollback outcome is known", async () => {
    const f = await fixture();
    const source = "data:text/plain;base64,aGVsbG8=";
    const entered = deferred(),
        release = deferred();
    const controller = new AbortController();
    const storage = (f.assets as any).storage;
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementation(async (...args: any[]) => {
        await write(...args);
        entered.resolve();
        await release.promise;
    });
    const created = f.assets.create(source, {}, { signal: controller.signal }).catch((error) => error);
    await entered.promise;
    const transformed = f.assets.transformAsync([h("audio", { src: source })]);
    controller.abort(new Error("cancelled"));
    release.resolve();
    expect(await created).toMatchObject({ message: "cancelled" });
    const element = h.parse(await transformed)[0];
    // Failed preparation retains the original URL rather than a rolled-back ID.
    expect(element.attrs.id).toBeUndefined();
    expect(element.attrs.src).toBe(source);
    expect(await f.ctx.database.get(TableName.Assets, {})).toEqual([]);
    expect(await readdir(f.config.storagePath)).toEqual([]);
    const retry = await f.assets.create(source);
    expect(await f.assets.read(retry)).toEqual(Buffer.from("hello"));
    expect(await f.ctx.database.get(TableName.Assets, {})).toMatchObject([{ id: retry }]);
});

it("keeps a shared non-cancellable writer intact when a joining create is cancelled", async () => {
    const f = await fixture();
    const source = "data:text/plain;base64,aGVsbG8=";
    const entered = deferred(),
        release = deferred();
    const storage = (f.assets as any).storage;
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementation(async (...args: any[]) => {
        entered.resolve();
        await release.promise;
        return write(...args);
    });
    const original = f.assets.create(source);
    await entered.promise;
    const controller = new AbortController();
    const joining = f.assets.create(source, {}, { signal: controller.signal }).catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new Error("joining cancelled"));
    release.resolve();
    const id = await original;
    expect(await joining).toMatchObject({ message: "joining cancelled" });
    expect(await f.assets.read(id)).toEqual(Buffer.from("hello"));
    expect(await f.ctx.database.get(TableName.Assets, {})).toMatchObject([{ id }]);
    expect(await readdir(f.config.storagePath)).toEqual([id]);
});
