import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Services } from "koishi-plugin-yesimbot/shared";
import { afterEach, expect, it, vi } from "vitest";

import { StickerService } from "../src/service";

const dirs: string[] = [];
afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(chat: (options: any) => Promise<any>) {
    const storagePath = await mkdtemp(path.join(os.tmpdir(), "sticker-test-"));
    dirs.push(storagePath);
    const records: any[] = [];
    let dispose!: () => void;
    let vision = true;
    const ctx: any = {
        on: (_event: string, listener: () => void) => {
            dispose = listener;
        },
        logger: { info() {}, error() {}, debug() {}, warn() {} },
        model: { extend() {} },
        database: { select: () => ({ execute: async () => records }), create: async (_table: string, record: any) => records.push(record) },
        [Services.Asset]: {
            read: async (_id: string, options: any) => (options.format === "buffer" ? Buffer.from("image") : "data:image/jpeg;base64,aW1hZ2U="),
        },
        [Services.Model]: { getChatModel: () => ({ isVisionModel: () => vision, chat }) },
    };
    const service = new StickerService(ctx, { storagePath, classifiModel: { providerName: "test", modelId: "test" }, classificationPrompt: "{{categories}}" });
    await service.whenReady();
    return {
        service,
        records,
        storagePath,
        dispose: () => dispose(),
        setVision: (value: boolean) => {
            vision = value;
        },
    };
}

it("does not persist a transient classification failure and can retry", async () => {
    let failed = true;
    const f = await fixture(async () => {
        if (failed) throw new Error("temporary");
        return { text: "庆祝成功" };
    });
    await expect(f.service.stealSticker("image", {} as any)).rejects.toThrow("temporary");
    expect(f.records).toEqual([]);
    expect(await readdir(f.storagePath)).toEqual([]);
    failed = false;
    expect((await f.service.stealSticker("image", {} as any)).category).toBe("庆祝成功");
});

it("does not persist an empty classification", async () => {
    const f = await fixture(async () => ({ text: "  " }));
    await expect(f.service.stealSticker("image", {} as any)).rejects.toThrow("分类");
    expect(f.records).toEqual([]);
    expect(await readdir(f.storagePath)).toEqual([]);
});

it("can classify after a model gains vision without keeping failed files", async () => {
    const f = await fixture(async () => ({ text: "庆祝成功" }));
    f.setVision(false);
    await expect(f.service.stealSticker("image", {} as any)).rejects.toThrow("多模态模型");
    expect(await readdir(f.storagePath)).toEqual([]);
    f.setVision(true);
    expect((await f.service.stealSticker("image", {} as any)).category).toBe("庆祝成功");
});

it("aborts an in-flight classification on disposal and never persists its late result", async () => {
    let finish!: (value: any) => void;
    let started!: () => void;
    let signal: AbortSignal | undefined;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    const f = await fixture(async (options) => {
        signal = options.abortSignal;
        started();
        return new Promise((resolve) => {
            finish = resolve;
        });
    });
    const pending = f.service.stealSticker("image", {} as any);
    await entered;
    f.dispose();
    expect(signal?.aborted).toBe(true);
    finish({ text: "庆祝成功" });
    await expect(pending).rejects.toThrow("停止");
    expect(f.records).toEqual([]);
    expect(await readdir(f.storagePath)).toEqual([]);
});

it("aborts a pending image import download on disposal", async () => {
    const f = await fixture(async () => ({ text: "庆祝成功" }));
    const file = path.join(f.storagePath, "urls.txt");
    await writeFile(file, "https://images.invalid/image");
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    vi.stubGlobal("fetch", async (_url: string, init: any) => {
        signal = init.signal;
        started();
        return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        });
    });
    try {
        const pending = f.service.importEmojiHubTxt(file, "test", { sendQueued: async () => [] } as any);
        await entered;
        f.dispose();
        expect(signal?.aborted).toBe(true);
        await expect(pending).rejects.toThrow("停止");
        expect(f.records).toEqual([]);
        expect(await readdir(f.storagePath)).toEqual(["temp", "urls.txt"]);
    } finally {
        vi.unstubAllGlobals();
    }
});

it("rejects imports after the service is disposed", async () => {
    const f = await fixture(async () => ({ text: "庆祝成功" }));
    f.dispose();
    await expect(f.service.importFromDirectory(f.storagePath, { sendQueued: async () => [] } as any)).rejects.toThrow("停止");
});
