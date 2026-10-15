import { EventEmitter } from "node:events";

import { Services } from "koishi-plugin-yesimbot/shared";
import { afterEach, expect, it, vi } from "vitest";

import VisionTools, { type Config } from "../src";

const network = vi.hoisted(() => ({ fetch: vi.fn<(url: unknown, init: any) => Promise<Response>>() }));
vi.mock("undici", async (load) => ({ ...(await load<typeof import("undici")>()), fetch: network.fetch }));
afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
});
function fixture(config: Partial<Config> = {}) {
    const hooks: Record<string, () => any> = {};
    const browser = new EventEmitter();
    const asset = { read: async () => "data:image/png;base64,aW1hZ2U=", getInfo: async () => ({ mime: "image/png" }) };
    const logger = Object.assign(() => logger, { info() {}, warn() {}, error() {} });
    const ctx: any = {
        on: (event: string, listener: () => any) => {
            hooks[event] = listener;
        },
        logger,
        puppeteer: { browser },
        get: (name: string) => (name === Services.Asset ? asset : undefined),
    };
    return { tools: new VisionTools(ctx, { engine: "google_vision", googleVision: { api_key: "test" }, ...config }), hooks, browser, ctx };
}

it("aborts image search requests on disposal", async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    network.fetch.mockImplementation(async (_url, init) => {
        signal = init.signal;
        started();
        return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        });
    });
    const f = fixture();
    const pending = f.tools.searchImageSource({ image_id: "image" } as any);
    await entered;
    await f.hooks.dispose();
    expect(signal?.aborted).toBe(true);
    expect((await pending).status).toBe("error");
    expect((await f.tools.searchImageSource({ image_id: "image" } as any)).status).toBe("error");
});

it("removes the browser target listener when unloaded", async () => {
    const f = fixture();
    await f.hooks.ready();
    expect(f.browser.listenerCount("targetcreated")).toBe(1);
    await f.hooks.dispose?.();
    expect(f.browser.listenerCount("targetcreated")).toBe(0);
});

it("closes active scraper pages when unloaded", async () => {
    const f = fixture();
    let started!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    let closed = false;
    f.ctx.puppeteer.page = async () => ({
        setViewport: async () => {
            started();
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
        },
        close: async () => {
            closed = true;
        },
        setUserAgent: async () => {
            throw new Error("closed");
        },
        screenshot: async () => {},
    });
    const pending = f.tools.searchImageSourceWithGoogleLensScraper("image", { content: "data:image/png;base64,aW1hZ2U=", data: { mime: "image/png" } });
    await entered;
    await f.hooks.dispose?.();
    expect(closed).toBe(true);
    finish();
    expect((await pending).status).toBe("error");
});

it("returns a tool failure when the image asset cannot be read", async () => {
    const f = fixture();
    f.ctx.get = () => ({
        read: async () => {
            throw new Error("asset missing");
        },
    });
    const result = await f.tools.searchImageSource({ image_id: "image" } as any);
    expect(result.status).toBe("error");
});

it("does not report a provider error payload as a successful search", async () => {
    network.fetch.mockResolvedValue(new Response(JSON.stringify({ responses: [{ error: { message: "quota exceeded" } }] })));
    const f = fixture();
    const result = await f.tools.searchImageSource({ image_id: "image" } as any);
    expect(result.status).toBe("error");
});

it.each(["google_lens_serpapi", "serpapi_reverse_image"])("reports %s provider errors as failures", async (engine) => {
    network.fetch
        .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 200, image: { url: "https://images.invalid/image" } })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: "quota exceeded" })));
    const f = fixture({ engine: engine as Config["engine"], serpapi: { api_key: "test" }, uploader: { apiKey: "test" } });
    const result = await f.tools.searchImageSource({ image_id: "image" } as any);
    expect(result.status).toBe("error");
});

it("does not publish a scraper result that completes after disposal", async () => {
    const f = fixture();
    let started!: () => void;
    let finish!: (value: any) => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    vi.spyOn(f.tools as any, "runGoogleLensScraper").mockImplementation(async () => {
        started();
        return new Promise((resolve) => {
            finish = resolve;
        });
    });
    const pending = f.tools.searchImageSourceWithGoogleLensScraper("image", { content: "data:image/png;base64,aW1hZ2U=", data: { mime: "image/png" } });
    await entered;
    await f.hooks.dispose();
    finish({ directResults: [], visualMatches: [], relatedSearches: [] });
    expect((await pending).status).toBe("error");
});
