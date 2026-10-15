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
        logger: { error() {} },
    };
    const service = new TTSService(ctx, config);
    const sent: any[] = [];
    const session = {
        send: async (message: any) => {
            sent.push(message);
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

it("falls back to text when sending the audio fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio"));
    const f = fixture();
    const sent: string[] = [];
    f.session.send = async (message) => {
        if (typeof message !== "string" && message.type === "audio") throw new Error("audio unsupported");
        sent.push(String(message));
    };
    expect((await f.tool.execute({ session: f.session, text: "hello" } as any)).status).toBe("success");
    expect(sent).toEqual(["hello"]);
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
