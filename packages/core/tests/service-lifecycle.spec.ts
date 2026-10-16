import { expect, it } from "vitest";

import YesImBot from "../src/index";

function fixture(services: any[]) {
    const notifications: unknown[] = [],
        logs: string[] = [];
    const root: any = Object.create(YesImBot.prototype);
    Object.defineProperty(root, "ctx", {
        value: {
            logger: Object.assign(() => ({ error() {} }), { info: (line: string) => logs.push(line), error() {} }),
            notifier: { create: (message: unknown) => notifications.push(message) },
        },
    });
    root.services = services;
    return { root, notifications, logs };
}
it("unload waits for the in-flight start and prevents later services from starting", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const events: string[] = [];
    const { root, logs } = fixture([
        {
            async start() {
                events.push("starting");
                await waiting;
                events.push("started");
            },
            async stop() {
                events.push("stopped");
            },
        },
        {
            async start() {
                events.push("later-started");
            },
            async stop() {
                events.push("later-stopped");
            },
        },
    ]);
    root.ready = root.startServices();
    expect(root.isReady).toBe(false);
    const stopping = root.stopServices();
    await Promise.resolve();
    expect(events).toEqual(["starting"]);
    release();
    await stopping;
    expect(events).toEqual(["starting", "started", "later-stopped", "stopped"]);
    expect(logs).not.toContain("所有服务已就绪");
});
it("overlapping unloads reuse one reverse-order cleanup", async () => {
    const events: string[] = [];
    const { root } = fixture([
        {
            async start() {},
            async stop() {
                events.push("first");
            },
        },
        {
            async start() {},
            async stop() {
                events.push("second");
                throw new Error("cleanup");
            },
        },
    ]);
    root.ready = root.startServices();
    await root.ready;
    expect(root.isReady).toBe(true);
    await Promise.all([root.stopServices(), root.stopServices()]);
    expect(root.isReady).toBe(false);
    expect(events).toEqual(["second", "first"]);
});
