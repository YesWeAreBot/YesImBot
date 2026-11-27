import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { downloadPublicMedia } from "../src/asset/download";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn<typeof lookup>() }));
vi.mock("node:http", () => ({ request: vi.fn<typeof httpRequest>() }));
vi.mock("node:https", () => ({ request: vi.fn<typeof httpsRequest>() }));

const responses: Readable[] = [];
function respond(body: Buffer | Readable, encoding?: string, extra: Record<string, string> = {}) {
    const response = (
        Buffer.isBuffer(body) ? Readable.from(Array.from({ length: Math.ceil(body.length / 7) }, (_, i) => body.subarray(i * 7, i * 7 + 7))) : body
    ) as Readable & { statusCode: number; headers: Record<string, string> };
    response.statusCode = 200;
    response.headers = { "content-type": "text/html; charset=utf-8", ...extra };
    if (encoding !== undefined) response.headers["content-encoding"] = encoding;
    responses.push(response);
    const request = (_url: unknown, _options: unknown, callback: (value: unknown) => void) => {
        const req = new EventEmitter() as EventEmitter & { end: () => void };
        req.end = () => queueMicrotask(() => callback(response));
        return req;
    };
    vi.mocked(httpRequest).mockImplementation(request as any);
    vi.mocked(httpsRequest).mockImplementation(request as any);
    return response;
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
});
afterEach(() => {
    for (const response of responses.splice(0)) response.destroy();
});

const payload = Buffer.from("<html><body>压缩网页：hello world</body></html>");
const encoders = [
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
] as const;

it.each(encoders)("decodes %s bytes from the public downloader while retaining the MIME type", async (encoding, compress) => {
    const body = compress(payload);
    const response = respond(body, encoding, { "content-length": String(body.length) });
    const result = await downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal);
    expect(result.data).toEqual(payload);
    expect(result.type).toBe("text/html");
    expect(response.destroyed).toBe(true);
});
it.each([undefined, "identity"])("preserves unencoded media at the byte limit (%s)", async (encoding) => {
    respond(payload, encoding);
    const result = await downloadPublicMedia("http://example.com/page", payload.length, new AbortController().signal);
    expect(result.data).toEqual(payload);
    expect(httpRequest).toHaveBeenCalledOnce();
});
it("accepts case-insensitive encodings and decodes stacked encodings in reverse order", async () => {
    respond(brotliCompressSync(gzipSync(payload)), " GZip , BR ");
    expect((await downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal)).data).toEqual(payload);
});
it("sniffs the decompressed media when Content-Type is absent", async () => {
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
    const response = respond(gzipSync(image), "gzip");
    delete response.headers["content-type"];
    const result = await downloadPublicMedia("https://example.com/image", 4096, new AbortController().signal);
    expect(result.data).toEqual(image);
    expect(result.type).toBe("image/png");
});
it.each(encoders)("bounds decompressed %s bytes even with a small compressed Content-Length", async (encoding, compress) => {
    const body = compress(Buffer.alloc(65536, 65));
    expect(body.length).toBeLessThan(1024);
    const response = respond(body, encoding, { "content-length": String(body.length) });
    await expect(downloadPublicMedia("https://example.com/page", 1024, new AbortController().signal)).rejects.toThrow("大小限制");
    expect(response.destroyed).toBe(true);
});
it("rejects an oversized encoded Content-Length before consuming the response", async () => {
    const response = respond(gzipSync(payload), "gzip", { "content-length": "100000" });
    await expect(downloadPublicMedia("https://example.com/page", 1024, new AbortController().signal)).rejects.toThrow("大小限制");
    expect(response.destroyed).toBe(true);
});
it("bounds wire bytes when Content-Length is understated", async () => {
    const body = Buffer.concat(Array.from({ length: 150 }, () => gzipSync(Buffer.alloc(0))));
    const response = respond(body, "gzip", { "content-length": "1" });
    await expect(downloadPublicMedia("https://example.com/page", 1024, new AbortController().signal)).rejects.toThrow("大小限制");
    expect(response.destroyed).toBe(true);
});
it.each(["compress", "gzip,,br"])("rejects unsupported or malformed Content-Encoding %s", async (encoding) => {
    const response = respond(payload, encoding);
    await expect(downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal)).rejects.toThrow("不支持的资源内容编码");
    expect(response.destroyed).toBe(true);
});
it.each(encoders)("rejects truncated %s data instead of returning partial media", async (encoding, compress) => {
    const body = compress(payload);
    const response = respond(body.subarray(0, Math.floor(body.length / 2)), encoding);
    await expect(downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal)).rejects.toMatchObject({ code: "Z_BUF_ERROR" });
    expect(response.destroyed).toBe(true);
});
it.each(encoders)("propagates %s decoding errors and destroys the source", async (encoding) => {
    const response = respond(Buffer.from("not a compressed stream"), encoding);
    await expect(downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal)).rejects.toMatchObject({ code: expect.any(String) });
    expect(response.destroyed).toBe(true);
});
it("propagates transport errors through the decoder", async () => {
    const source = Readable.from(
        (async function* () {
            yield gzipSync(payload).subarray(0, 10);
            throw new Error("transport interrupted");
        })(),
    );
    const response = respond(source, "gzip");
    await expect(downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal)).rejects.toThrow("transport interrupted");
    expect(response.destroyed).toBe(true);
});
it("cancels decoding and destroys a stalled response without waiting for EOF", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
        started = resolve;
    });
    const response = respond(
        new Readable({
            read() {
                started();
            },
        }),
        "gzip",
    );
    const result = downloadPublicMedia("https://example.com/page", 4096, controller.signal);
    // Attach a rejection handler immediately; make the assertion only after abort.
    const outcome = result.then(
        (value) => ({ value }),
        (error) => ({ error }),
    );
    await reading;
    controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const settled = await Promise.race([
            outcome,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("decoder did not honor abort")), 500);
            }),
        ]);
        expect(settled).toMatchObject({ error: { name: "AbortError" } });
    } finally {
        clearTimeout(timer);
        response.destroy(new Error("test cleanup"));
        await outcome;
    }
});
it("still refuses private network destinations before making a request", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as any);
    await expect(downloadPublicMedia("https://example.com/page", 4096, new AbortController().signal)).rejects.toThrow("不可访问");
    expect(httpsRequest).not.toHaveBeenCalled();
});
