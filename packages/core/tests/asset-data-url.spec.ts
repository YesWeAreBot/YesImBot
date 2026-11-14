import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Jimp } from "jimp";
import { Context, h } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { AssetService } from "../src/asset/service";
import { Config } from "../src/config";
import { loggingStub } from "./helpers/yesimbot";

async function fixture() {
    const baseDir = await mkdtemp(path.join(tmpdir(), "yesimbot-data-url-"));
    const ctx = new Context({ baseDir });
    ctx.plugin(memory);
    onTestFinished(async () => {
        await ctx.stop();
        await rm(baseDir, { recursive: true, force: true });
    });
    const assets = new AssetService(
        ctx,
        Config({
            storagePath: path.join(baseDir, "assets"),
            image: { processedCachePath: path.join(baseDir, "processed") },
            autoClear: { enabled: false },
        }),
        loggingStub(),
    );
    await ctx.start();
    await assets.start();
    return { assets, processed: path.join(baseDir, "processed") };
}

it("retains the image MIME and dimensions through data URL storage and rendering", async () => {
    const { assets } = await fixture();
    const png = await new Jimp({ width: 1, height: 1, color: 0xff0000ff }).getBuffer("image/png");
    const source = `data:image/png;base64,${png.toString("base64")}`;
    const id = await assets.create(source);

    expect(await assets.getInfo(id)).toMatchObject({ mime: "image/png", metadata: { width: 1, height: 1 } });
    expect(await assets.read(id, { format: "data-url" })).toBe(source);
    const encoded = await assets.encode([h("img", { id })]);
    expect(encoded[0].type).toBe("img");
    expect(encoded[0].attrs.src).toBe(source);
});

it("retains the text MIME and exact bytes through a data URL round trip", async () => {
    const { assets } = await fixture();
    const content = Buffer.from("hello 世界");
    const source = `data:text/plain;base64,${content.toString("base64")}`;
    const id = await assets.create(source);

    expect(await assets.getInfo(id)).toMatchObject({ mime: "text/plain" });
    expect(await assets.read(id)).toEqual(content);
    expect(await assets.read(id, { format: "data-url" })).toBe(source);
    const encoded = await assets.encode([h("file", { id })]);
    expect(encoded[0].type).toBe("file");
    expect(encoded[0].attrs.src).toBe(source);
});

it("makes transformAsync deduplicated references readable", async () => {
    const { assets } = await fixture();
    const source = `data:text/plain;base64,${Buffer.from("shared content").toString("base64")}`;
    const existingId = await assets.create(source);
    const elements = h.parse(await assets.transformAsync([h("audio", { src: source })]));

    expect(elements[0].attrs.id).toBe(existingId);
    expect(await assets.read(elements[0].attrs.id)).toEqual(Buffer.from("shared content"));
});

it("rejects damaged image conversion without storing the fallback bytes as JPEG", async () => {
    const { assets, processed } = await fixture();
    const source = `data:image/png;base64,${Buffer.from("broken image").toString("base64")}`;
    const id = await assets.create(source);
    await expect(assets.read(id, { format: "data-url", image: { process: true } })).rejects.toThrow();
    expect(await readdir(processed)).toEqual([]);
    expect(await assets.read(id, { format: "data-url" })).toBe(source);
});

it("does not use a legacy cache entry that might contain unconverted bytes", async () => {
    const { assets, processed } = await fixture();
    const png = await new Jimp({ width: 1, height: 1, color: 0xff0000ff }).getBuffer("image/png");
    const id = await assets.create(`data:image/png;base64,${png.toString("base64")}`);
    await writeFile(path.join(processed, id + ".p.jpeg"), png);
    const result = (await assets.read(id, { format: "data-url", image: { process: true } })) as string;
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(result.split(",")[1], "base64");
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    await expect(Jimp.read(bytes)).resolves.toMatchObject({ width: 1, height: 1 });
});

it("rebuilds a truncated converted cache file from the original image", async () => {
    const { assets, processed } = await fixture();
    const png = await new Jimp({ width: 1, height: 1, color: 0xff0000ff }).getBuffer("image/png");
    const id = await assets.create(`data:image/png;base64,${png.toString("base64")}`);
    const options = { format: "data-url", image: { process: true } } as const;
    const before = await assets.read(id, options);
    const [cacheFile] = await readdir(processed);
    await writeFile(path.join(processed, cacheFile), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await expect(assets.read(id, options)).resolves.toBe(before);
});
