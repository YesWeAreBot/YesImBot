import { mkdtemp, rm } from "node:fs/promises";
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
    return assets;
}

it("retains the image MIME and dimensions through data URL storage and rendering", async () => {
    const assets = await fixture();
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
    const assets = await fixture();
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
    const assets = await fixture();
    const source = `data:text/plain;base64,${Buffer.from("shared content").toString("base64")}`;
    const existingId = await assets.create(source);
    const elements = h.parse(await assets.transformAsync([h("audio", { src: source })]));

    expect(elements[0].attrs.id).toBe(existingId);
    expect(await assets.read(elements[0].attrs.id)).toEqual(Buffer.from("shared content"));
});
