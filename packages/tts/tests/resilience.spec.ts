import { afterEach, expect, it, vi } from "vitest";

import { OpenAudioAdapter } from "../src/adapters/open-audio";
import { TTSService } from "../src/service";

const config: any = { provider: "open-audio", "open-audio": { baseURL: "https://tts.invalid", toolDesc: "tts" } };
function fixture() {
    let dispose!: () => Promise<void>;
    const ctx: any = {
        on: (_event: string, listener: () => Promise<void>) => {
            dispose = listener;
        },
        logger: { error() {}, warn() {} },
    };
    const service = new TTSService(ctx, config);
    const sent: any[] = [];
    const session = {
        send: async (message: any) => {
            sent.push(message);
            return ["receipt"];
        },
    };
    return { tool: service.getTool()!, session, sent, dispose: () => dispose(), ctx };
}
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

it("falls back to literal text when synthesis fails", async () => {
    vi.stubGlobal("fetch", async () => {
        throw new Error("temporary");
    });
    const f = fixture();
    const result = await f.tool.execute({ session: f.session, text: "Hello <at id='all'/>" } as any);
    expect(f.sent.map(String)).toEqual(["Hello &lt;at id='all'/&gt;"]);
    expect(result.status).toBe("success");
    expect(result.result).toMatchObject({ fallback: "text" });
});

it("does not replay text when audio delivery is unknown", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio"));
    const f = fixture();
    f.session.send = vi.fn(async () => {
        throw new Error("transport failed after submission");
    });
    const result = await f.tool.execute({ session: f.session, text: "hello" } as any);
    expect(result.status).toBe("error");
    expect(result.metadata.deliveryUnknown).toBe(true);
    expect(f.session.send).toHaveBeenCalledTimes(1);
});

it("aborts HTTP synthesis on disposal without sending a fallback", async () => {
    let started!: () => void;
    let signal!: AbortSignal;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    vi.stubGlobal("fetch", async (_url: any, init: any) => {
        signal = init.signal;
        started();
        return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
    });
    const f = fixture();
    const pending = f.tool.execute({ session: f.session, text: "hello" } as any);
    await entered;
    await f.dispose();
    expect(signal?.aborted).toBe(true);
    expect((await pending).status).toBe("error");
    expect(f.sent).toEqual([]);
});

it("rejects synthesis started after an adapter has stopped", async () => {
    const f = fixture();
    const adapter = new OpenAudioAdapter(f.ctx, config["open-audio"]);
    await adapter.stop();
    vi.stubGlobal("fetch", async () => new Response("audio"));
    await expect(adapter.synthesize({ text: "hello" } as any)).rejects.toThrow("stopped");
});

it("reports a failure if text fallback also cannot be sent", async () => {
    vi.stubGlobal("fetch", async () => {
        throw new Error("temporary");
    });
    const f = fixture();
    f.session.send = async () => {
        throw new Error("transport unavailable");
    };
    expect((await f.tool.execute({ session: f.session, text: "hello" } as any)).status).toBe("error");
});

it("preserves text even when an adapter throws a non-Error value", async () => {
    vi.stubGlobal("fetch", async () => {
        throw null;
    });
    const f = fixture();
    expect((await f.tool.execute({ session: f.session, text: "hello" } as any)).status).toBe("success");
    expect(f.sent.map(String)).toEqual(["hello"]);
});

it.each([undefined, [], [""], [], [1]])("does not report success for invalid delivery receipt %j", async (receipt) => {
    vi.stubGlobal("fetch", async () => new Response("audio"));
    const f = fixture();
    f.session.send = vi.fn(async () => receipt as any);
    const result = await f.tool.execute({ session: f.session, text: "hello" } as any);
    expect(result.status).toBe("error");
    expect(result.metadata.deliveryUnknown).toBe(true);
    expect(f.session.send).toHaveBeenCalledTimes(1);
});
it("rechecks plugin filtering after synthesis before sending", async () => {
    const f = fixture();
    f.ctx.filter = () => true;
    vi.stubGlobal("fetch", async () => {
        f.ctx.filter = () => false;
        return new Response("audio");
    });
    expect((await f.tool.execute({ session: f.session, text: "hello" } as any)).status).toBe("error");
    expect(f.sent).toEqual([]);
});
it("passes per-call cancellation without poisoning the shared adapter", async () => {
    const f = fixture();
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    vi.stubGlobal("fetch", async (_url: unknown, options: any) => {
        entered();
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    });
    const pending = f.tool.execute({ session: f.session, text: "hello", toolContext: { signal: controller.signal } } as any);
    await started;
    controller.abort(new Error("cancelled"));
    expect((await pending).status).toBe("error");
    expect(f.sent).toEqual([]);
    vi.stubGlobal("fetch", async () => new Response("audio"));
    expect((await f.tool.execute({ session: f.session, text: "next" } as any)).status).toBe("success");
});
it.each(["", "local-token"])("sends OpenAudio credentials only in the Authorization header (%s)", async (apiKey) => {
    const request = vi.fn(async () => new Response("audio"));
    vi.stubGlobal("fetch", request);
    const f = fixture();
    const adapter = new OpenAudioAdapter(f.ctx, { ...config["open-audio"], apiKey } as any);
    await adapter.synthesize({ text: "hello" });
    expect(adapter.name).toBe("open-audio");
    const headers = (request.mock.calls[0] as any)[1].headers;
    expect(headers.Authorization).toBe(apiKey ? "Bearer local-token" : undefined);
});
