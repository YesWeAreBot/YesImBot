import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Context, Logger } from "koishi";
import { afterEach, expect, it, vi } from "vitest";

import { LoggerService } from "../src/logger";
import { AppError, ErrorDefinitions, handleError, initializeErrorReporter } from "../src/shared/errors";

const services: LoggerService[] = [];
afterEach(async () => {
    for (const service of services.splice(0)) await service.stop();
    initializeErrorReporter({ enabled: false }, new Logger("legacy-reset"));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function service(name: string, enabled: boolean, directory?: string) {
    const ctx = new Context();
    const instance = new LoggerService(ctx, {
        logging: { level: 0, local: directory ? { enabled: true, directory, level: 3, maxFileSizeMB: 1, maxFiles: 2, retentionDays: 7 } : undefined },
        errorReporting: { enabled, pasteServiceUrl: `https://${name}.invalid/`, includeSensitiveInfo: true },
        providers: [{ apiKey: `${name}-private-provider-key` }],
    } as any);
    services.push(instance);
    const local = vi.spyOn(instance, "recordError");
    return { instance, local };
}

function captureUploads() {
    const uploads: Array<{ endpoint: string; dump: string }> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (endpoint, init) => {
            uploads.push({ endpoint: String(endpoint), dump: String((init.body as FormData).get("c")) });
            return new Response(JSON.stringify({ url: `${endpoint}report` }));
        }),
    );
    return uploads;
}

async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

for (const reverse of [false, true]) {
    it(`keeps disabled and enabled instance reporting separate (${reverse ? "reverse" : "forward"} construction)`, async () => {
        const uploads = captureUploads();
        const pair = reverse ? [service("b", true), service("a", false)] : [service("a", false), service("b", true)];
        const [a, b] = reverse ? pair.reverse() : pair;
        const aId = handleError(a.instance.getLogger("shared").extend("child"), new Error("a-private-provider-key"), "A");
        const bId = handleError(b.instance.getLogger("shared"), new Error("b-private-provider-key"), "B");
        await settle();
        expect(a.local).toHaveBeenCalledExactlyOnceWith(aId, expect.any(Error));
        expect(b.local).toHaveBeenCalledExactlyOnceWith(bId, expect.any(Error));
        expect(uploads.map((upload) => upload.endpoint)).toEqual(["https://b.invalid/"]);
        expect(uploads[0].dump).not.toContain("b-private-provider-key");
    });

    it(`keeps enabled endpoints and secret masks with their owner (${reverse ? "reverse" : "forward"} construction)`, async () => {
        const uploads = captureUploads();
        const pair = reverse ? [service("b", true), service("a", true)] : [service("a", true), service("b", true)];
        const [a, b] = reverse ? pair.reverse() : pair;
        handleError(
            a.instance.getLogger("same").extend("child").extend("nested"),
            new AppError(ErrorDefinitions.SYSTEM.UNKNOWN, {
                context: { requestId: "a-private-provider-key" },
            }),
            "A",
        );
        handleError(b.instance._logger.extend("child"), new Error("b-private-provider-key"), "B");
        await settle();
        expect(uploads.map((upload) => upload.endpoint)).toEqual(["https://a.invalid/", "https://b.invalid/"]);
        expect(uploads[0].dump).not.toContain("a-private-provider-key");
        expect(uploads[0].dump).toContain("a-pr");
        expect(uploads[1].dump).not.toContain("b-private-provider-key");
        expect(a.local).toHaveBeenCalledTimes(1);
        expect(b.local).toHaveBeenCalledTimes(1);
    });
}

it("does not redirect disposed owner loggers or unowned loggers to another instance", async () => {
    const uploads = captureUploads();
    const a = service("a", true);
    const staleLogger = a.instance.getLogger("same").extend("old");
    const b = service("b", true);
    await a.instance.stop();
    handleError(staleLogger.extend("later"), new Error("disposed"), "A");
    handleError(Object.assign(new Logger("unowned"), { level: 0 }), new Error("unowned"), "unowned");
    handleError(b.instance.getLogger("same"), new Error("live"), "B");
    await settle();
    expect(a.local).not.toHaveBeenCalled();
    expect(b.local).toHaveBeenCalledTimes(1);
    expect(uploads.map((upload) => upload.endpoint)).toEqual(["https://b.invalid/"]);
});

it("does not let explicit legacy initialization override an instance owner", async () => {
    const uploads = captureUploads();
    const a = service("a", false);
    initializeErrorReporter({ enabled: true, pasteServiceUrl: "https://legacy.invalid/" }, new Logger("legacy"));
    handleError(a.instance.getLogger("a"), new Error("owned"), "A");
    await settle();
    expect(a.local).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual([]);
});

it("saves each instance error only to its own real local files and masks its provider key", async () => {
    const uploads = captureUploads();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reporter-owner-"));
    try {
        const a = service("a", false, path.join(root, "a"));
        const b = service("b", true, path.join(root, "b"));
        const aId = handleError(a.instance.getLogger("same").extend("child"), new Error("a-private-provider-key"), "A");
        const bId = handleError(b.instance.getLogger("same"), new Error("b-private-provider-key"), "B");
        await settle();
        await vi.waitFor(() => expect(uploads).toHaveLength(1));
        await Promise.all([a.instance.stop(), b.instance.stop()]);
        const read = async (name: string) =>
            (await Promise.all((await fs.readdir(path.join(root, name))).map((file) => fs.readFile(path.join(root, name, file), "utf8")))).join("");
        const [aText, bText] = await Promise.all([read("a"), read("b")]);
        expect(aText).toContain(aId);
        expect(aText).not.toContain(bId);
        expect(aText).not.toContain("a-private-provider-key");
        expect(bText).toContain(bId);
        expect(bText).not.toContain(aId);
        expect(bText).not.toContain("b-private-provider-key");
        expect(uploads.map((upload) => upload.endpoint)).toEqual(["https://b.invalid/"]);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

it("keeps a disposed owner bound even while a legacy fallback is active", async () => {
    const uploads = captureUploads();
    const a = service("a", true);
    const logger = a.instance.getLogger("a");
    await a.instance.stop();
    initializeErrorReporter({ enabled: true, pasteServiceUrl: "https://legacy.invalid/" }, Object.assign(new Logger("legacy"), { level: 0 }));
    handleError(logger.extend("disposed"), new Error("disposed"), "A");
    await settle();
    expect(a.local).not.toHaveBeenCalled();
    expect(uploads).toEqual([]);
});
