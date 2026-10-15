import { writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { FishAudioAdapter } from "../src/adapters/fish-audio";
import { IndexTTS2Adapter } from "../src/adapters/index-tts2";

const network = vi.hoisted(() => ({ fetch: vi.fn<(url: unknown, init: any) => Promise<Response>>() }));
vi.mock("undici", async (load) => ({ ...(await load<typeof import("undici")>()), fetch: network.fetch }));
afterEach(() => {
    vi.resetAllMocks();
});
const ctx: any = { logger: { error() {}, info() {} }, i18n: { render: () => ["same"] } };

it("shares a stoppable signal with FishAudio HTTP requests", async () => {
    let signal: AbortSignal | undefined;
    network.fetch.mockImplementation(async (_url, init) => {
        signal = init.signal;
        return new Response("audio");
    });
    const adapter = new FishAudioAdapter(ctx, { baseURL: "https://tts.invalid" } as any);
    await adapter.synthesize({ text: "hello" } as any);
    await adapter.stop();
    expect(signal?.aborted).toBe(true);
    await expect(adapter.synthesize({ text: "hello" } as any)).rejects.toThrow("stopped");
});

it("passes a cancellable signal through all IndexTTS2 HTTP stages", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tts-reference-"));
    try {
        const prompt_audio = path.join(dir, "reference.wav");
        await writeFile(prompt_audio, "reference");
        const signals: Array<AbortSignal | undefined> = [];
        const http: any = async (_url: string, options: any) => {
            signals.push(options.signal);
            return { data: Buffer.from("audio") };
        };
        http.post = async (url: string, _body: any, options: any) => {
            signals.push(options.signal);
            return url.includes("/upload") ? ["/uploaded.wav"] : { event_id: "event" };
        };
        http.get = async (_url: string, options: any) => {
            signals.push(options.signal);
            return 'event: complete\ndata: [{"value":{"url":"https://tts.invalid/audio.wav"}}]\n';
        };
        const adapter = new IndexTTS2Adapter({ ...ctx, http }, { baseURL: "https://tts.invalid", prompt_audio } as any);
        await adapter.synthesize({ text: "hello" } as any);
        await adapter.stop();
        expect(signals).toHaveLength(4);
        expect(signals.every((signal) => signal?.aborted)).toBe(true);
        await expect(adapter.synthesize({ text: "hello" } as any)).rejects.toThrow("stopped");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
