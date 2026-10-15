import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { h } from "koishi";
import { it, expect } from "vitest";

import StickerTools from "../src/index";
import { StickerService } from "../src/service";
it("send_sticker must not send late read after plugin disposal", async () => {
    const storagePath = await mkdtemp(path.join(os.tmpdir(), "sticker-late-"));
    const events: Record<string, Function[]> = {};
    const log = { info() {}, warn() {}, error() {}, debug() {} };
    const command: any = {
        option() {
            return this;
        },
        alias() {
            return this;
        },
        action() {
            return this;
        },
    };
    const ctx: any = {
        logger: Object.assign(() => log, log),
        on(event: string, fn: Function) {
            (events[event] ??= []).push(fn);
        },
        command() {
            return command;
        },
        model: { extend() {} },
    };
    const plugin: any = new StickerTools(ctx, { storagePath } as any);
    try {
        await plugin.stickerService.whenReady();
        let finish!: Function, started!: Function;
        const entered = new Promise<void>((r) => (started = r));
        plugin.stickerService.getRandomSticker = () => {
            started();
            return new Promise((r) => (finish = r));
        };
        const sent: any[] = [];
        const pending = plugin.sendRandomSticker({ category: "test", session: { sendQueued: async (v: any) => sent.push(v) } });
        await entered;
        await Promise.all(events.dispose.map((fn) => fn()));
        finish(h.image("https://example.invalid/image"));
        await pending;
        expect(sent).toEqual([]);
    } finally {
        await rm(storagePath, { recursive: true, force: true });
    }
});
it("directory import must not emit progress after disposal during directory scan", async () => {
    const storagePath = await mkdtemp(path.join(os.tmpdir(), "sticker-import-"));
    let dispose!: Function;
    const ctx: any = {
        on(_event: string, fn: Function) {
            dispose = fn;
        },
        logger: { info() {}, error() {}, debug() {} },
        model: { extend() {} },
    };
    const service: any = new StickerService(ctx, { storagePath } as any);
    try {
        await service.whenReady();
        let finish!: Function, started!: Function;
        const entered = new Promise<void>((r) => (started = r));
        service.dirExists = () => {
            started();
            return new Promise((r) => (finish = r));
        };
        const sent: any[] = [];
        const pending = service.importFromDirectory(storagePath, { sendQueued: async (v: any) => sent.push(v) });
        await entered;
        dispose();
        finish(true);
        await pending.catch(() => {});
        expect(sent).toEqual([]);
    } finally {
        await rm(storagePath, { recursive: true, force: true });
    }
});
