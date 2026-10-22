import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import HTTP from "@cordisjs/plugin-http";
import memory from "@koishijs/plugin-database-memory";
import { Bot, Context, h } from "koishi";
import { expect, it, onTestFinished, vi } from "vitest";

import { AssetService } from "../src/asset/service";
import { Config } from "../src/config";
import { TableName } from "../src/shared/constants";
import { loggingStub } from "./helpers/yesimbot";

async function fixture(maxBytes = 1024 * 1024) {
    const baseDir = await mkdtemp(path.join(tmpdir(), "asset-adapter-media-"));
    const ctx = new Context({ baseDir });
    ctx.plugin(HTTP);
    ctx.plugin(memory);
    const config = Config({
        maxFileSize: maxBytes / 1024 / 1024,
        storagePath: path.join(baseDir, "assets"),
        image: { processedCachePath: path.join(baseDir, "processed") },
        autoClear: { enabled: false },
        recoveryEnabled: true,
    });
    const assets = new AssetService(ctx, config, loggingStub());
    let bot!: Bot;
    const botFork = ctx.plugin((botCtx) => {
        bot = new (class extends Bot {})(botCtx, {}, "lark");
        bot.selfId = "app";
    });
    onTestFinished(async () => {
        await botFork.dispose();
        await ctx.stop();
        await rm(baseDir, { recursive: true, force: true });
    });
    await ctx.start();
    await assets.start();
    const source = bot.getInternalUrl("/im/v1/messages/message/resources/key", { type: "file" });
    return { ctx, config, assets, bot, source };
}

for (const method of ["transform", "transformAsync"] as const) {
    for (const tag of ["img", "audio", "video", "file"]) {
        it(`persists a Lark ${tag} internal resource through ${method} using the Satori file handler`, async () => {
            const f = await fixture();
            const body = Buffer.from(`private ${tag}`);
            f.bot.defineInternalRoute("/im/v1/messages/:message/resources/:key", async ({ method, params, query }) => {
                expect(method).toBe("GET");
                expect(params).toEqual({ message: "message", key: "key" });
                expect(query.get("type")).toBe("file");
                return { status: 200, body, headers: new Headers({ "content-type": "text/plain" }) };
            });
            const head = vi.spyOn(f.ctx.http, "head");
            // Prove this is a supported adapter source before exercising the asset boundary.
            expect(Buffer.from((await f.ctx.http.file(f.source)).data)).toEqual(body);
            const element = h.parse(await f.assets[method]([h(tag, { src: f.source, filename: "private.txt" })]))[0];
            expect(element.attrs.src).toBeUndefined();
            expect(element.attrs.id).toBeTruthy();
            // create joins background persistence when transformAsync returns a reserved ID.
            expect(await f.assets.create(f.source)).toBe(element.attrs.id);
            expect(await f.assets.read(element.attrs.id)).toEqual(body);
            expect(await f.assets.getInfo(element.attrs.id)).toMatchObject({ mime: "text/plain", metadata: { src: f.source } });
            expect(head).not.toHaveBeenCalled();
        });
    }
}

it("rejects oversized internal media before writing a resource or metadata", async () => {
    const f = await fixture();
    f.bot.defineInternalRoute("/im/v1/messages/:message/resources/:key", async () => ({
        status: 200,
        body: Buffer.alloc(1024 * 1024 + 1, 65),
        headers: new Headers({ "content-type": "text/plain" }),
    }));
    await expect(f.assets.create(f.source)).rejects.toThrow(/超出限制/);
    expect(await f.ctx.database.get(TableName.Assets, {})).toEqual([]);
    expect(await readdir(f.config.storagePath)).toEqual([]);
});

it("propagates internal resource access errors without persisting content", async () => {
    const f = await fixture();
    f.bot.defineInternalRoute("/im/v1/messages/:message/resources/:key", async () => ({ status: 403 }));
    await expect(f.assets.create(f.source)).rejects.toThrow("status code: 403");
    expect(await f.ctx.database.get(TableName.Assets, {})).toEqual([]);
    expect(await readdir(f.config.storagePath)).toEqual([]);
});

it("recovers missing internal media through the adapter file handler", async () => {
    const f = await fixture();
    const body = Buffer.from("recoverable");
    f.bot.defineInternalRoute("/im/v1/messages/:message/resources/:key", async () => ({
        status: 200,
        body,
        headers: new Headers({ "content-type": "text/plain" }),
    }));
    const id = await f.assets.create(f.source, { src: f.source });
    await unlink(path.join(f.config.storagePath, id));
    expect(await f.assets.read(id)).toEqual(body);
    expect(await readdir(f.config.storagePath)).toEqual([id]);
});

it("does not persist internal media when cancelled while the adapter is resolving it", async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const resolving = new Promise<void>((resolve) => (entered = resolve));
    f.bot.defineInternalRoute("/im/v1/messages/:message/resources/:key", async () => {
        entered();
        await pending;
        return { status: 200, body: Buffer.from("private"), headers: new Headers({ "content-type": "text/plain" }) };
    });
    const controller = new AbortController();
    const created = f.assets.create(f.source, {}, { signal: controller.signal }).catch((error) => error);
    await resolving;
    controller.abort(new Error("cancelled while resolving"));
    release();
    expect(await created).toMatchObject({ message: "cancelled while resolving" });
    expect(await f.ctx.database.get(TableName.Assets, {})).toEqual([]);
    expect(await readdir(f.config.storagePath)).toEqual([]);
});

it("continues to reject arbitrary unsupported resource protocols", async () => {
    const f = await fixture();
    await expect(f.assets.create("ftp://assets.invalid/file")).rejects.toThrow(/不支持的资源来源/);
    await expect(f.assets.create("telegram:unknown")).rejects.toThrow(/不支持的资源来源/);
});

for (const method of ["transform", "transformAsync"] as const) {
    it(`does not mistake a Slack file ID for a stored asset ID during ${method}`, async () => {
        const f = await fixture();
        const source = "https://files.slack.com/files-pri/T-team-F-file/download/private.txt";
        const body = Buffer.from("resolved by installed file handler");
        f.ctx.on("http/file", (url) => {
            if (url === source) return { type: "text/plain", mime: "text/plain", data: body, filename: "private.txt" };
        });
        vi.spyOn(f.ctx.http, "head").mockRejectedValue(new Error("HEAD unsupported"));
        const element = h.parse(await f.assets[method]([h("file", { src: source, id: "F-file", filename: "private.txt" })]))[0];
        expect(element.attrs.id).not.toBe("F-file");
        expect(element.attrs.src).toBeUndefined();
        expect(await f.assets.create(source)).toBe(element.attrs.id);
        expect(await f.assets.read(element.attrs.id)).toEqual(body);
        expect((await f.assets.encode([element]))[0].attrs.src).toBe(`data:text/plain;base64,${body.toString("base64")}`);
    });
}

it("keeps verified stored asset IDs without fetching a stale source again", async () => {
    const f = await fixture();
    const id = await f.assets.create(Buffer.from("stored"));
    const element = h("file", { id, src: "https://expired.invalid/file" });
    expect(h.parse(await f.assets.transform([element]))[0].attrs).toEqual(element.attrs);
    expect(await f.assets.read(id)).toEqual(Buffer.from("stored"));
});

it("downloads Slack private attachments with the originating bot token without persisting credentials", async () => {
    const f = await fixture();
    const token = "xoxb-fixture-private-token";
    const source = "https://files.slack.com/files-pri/T-team-F-file/private.txt";
    const download = vi.spyOn(f.ctx.http, "get").mockImplementation(async (_url: any, options: any) => {
        if (options?.headers?.Authorization !== `Bearer ${token}`) throw new Error("authorization required");
        return Buffer.from("private body");
    });
    const original = h("file", { src: source, id: "F-file" });
    const session = { platform: "slack", bot: { config: { botToken: token } } } as any;
    const parsed = h.parse(await f.assets.transform([original], { session } as any))[0];
    expect(parsed.attrs.id).not.toBe("F-file");
    expect(parsed.attrs.src).toBeUndefined();
    expect(await f.assets.read(parsed.attrs.id)).toEqual(Buffer.from("private body"));
    expect(download).toHaveBeenCalledWith(source, expect.objectContaining({ redirect: "error", headers: { Authorization: `Bearer ${token}` } }));
    const stored = JSON.stringify(await f.ctx.database.get(TableName.Assets, {}));
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(source);
});

it.each(["https://files.slack.com.evil.invalid/files-pri/file", "http://files.slack.com/files-pri/file", "https://files.slack.com/other/file"])(
    "never attaches a Slack token to %s",
    async (source) => {
        const f = await fixture();
        const seen: any[] = [];
        vi.spyOn(f.ctx.http, "head").mockResolvedValue(new Headers());
        vi.spyOn(f.ctx.http, "file").mockImplementation(async (_url: any, options: any) => {
            seen.push(options);
            return { data: Buffer.from("public body"), type: "text/plain", filename: "public.txt" };
        });
        await f.assets.transform([h("file", { src: source })], { session: { platform: "slack", bot: { config: { botToken: "private-fixture" } } } } as any);
        expect(seen).toHaveLength(1);
        expect(JSON.stringify(seen)).not.toContain("private-fixture");
    },
);
