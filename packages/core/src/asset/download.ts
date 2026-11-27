import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { getMimeType } from "../shared/utils";
import type { FileResponse } from "./types";

const blocked = new BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3],
] as const)
    blocked.addSubnet(address, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

export function publicMediaAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return !blocked.check(address, "ipv4");
    return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export async function readMediaStream(body: AsyncIterable<Uint8Array>, limit: number, declaredLength?: string | null): Promise<Buffer> {
    if (declaredLength && Number(declaredLength) > limit) throw new Error("资源超过大小限制");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
        size += chunk.byteLength;
        if (size > limit) throw new Error("资源超过大小限制");
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, size);
}

async function readMediaResponse(response: IncomingMessage, limit: number, signal: AbortSignal): Promise<Buffer> {
    const declaredLength = response.headers["content-length"];
    if (declaredLength && Number(declaredLength) > limit) throw new Error("资源超过大小限制");
    const encoding = response.headers["content-encoding"];
    const encodings = encoding === undefined ? [] : encoding.split(",").map((value) => value.trim().toLowerCase());
    // Bound decoder depth as well as wire, intermediate and final byte counts.
    if (encodings.length > 4 || encodings.some((value) => !["identity", "gzip", "deflate", "br"].includes(value))) {
        throw new Error("不支持的资源内容编码");
    }
    const boundedStream = () => {
        let size = 0;
        return new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                size += chunk.byteLength;
                if (size > limit) callback(new Error("资源超过大小限制"));
                else callback(null, chunk);
            },
        });
    };
    const stages: Transform[] = [boundedStream()];
    // Content-Encoding lists the order of application; decode in reverse.
    for (const value of encodings.reverse()) {
        if (value === "identity") continue;
        const decoder = value === "gzip" ? createGunzip() : value === "deflate" ? createInflate() : createBrotliDecompress();
        stages.push(decoder, boundedStream());
    }
    const chunks: Buffer[] = [];
    let size = 0;
    await pipeline(
        [
            response,
            ...stages,
            new Writable({
                write(chunk: Buffer, _encoding, callback) {
                    chunks.push(Buffer.from(chunk));
                    size += chunk.byteLength;
                    callback();
                },
            }),
        ],
        { signal },
    );
    return Buffer.concat(chunks, size);
}

export function safeMediaFilename(value: string | undefined): string | undefined {
    return (
        value
            ?.split(/[/\\]/)
            .pop()
            ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
            .trim()
            .slice(0, 200) || undefined
    );
}

export async function downloadPublicMedia(input: string, limit: number, signal: AbortSignal, headers?: Record<string, string>): Promise<FileResponse> {
    let url = new URL(input);
    for (let redirects = 0; redirects <= 4; redirects++) {
        signal.throwIfAborted();
        if (!["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password) throw new Error("不允许的外部媒体地址");
        const hostname = url.hostname.replace(/^\[|\]$/g, "");
        const addresses = await lookup(hostname, { all: true });
        signal.throwIfAborted();
        if (!addresses.length || addresses.some(({ address }) => !publicMediaAddress(address))) throw new Error("外部媒体目标不可访问");
        const [target] = addresses;
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
            // Pin the vetted address and keep the original hostname for Host and TLS verification.
            request(
                url,
                {
                    agent: false,
                    family: target.family,
                    lookup: (_host, _options, callback) => callback(null, target.address, target.family),
                    signal,
                    headers,
                },
                resolve,
            )
                .once("error", reject)
                .end();
        });
        try {
            const status = response.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status) && response.headers.location && !headers) {
                url = new URL(response.headers.location, url);
                continue;
            }
            if (status < 200 || status >= 300) throw new Error(`资源下载失败（HTTP ${status}）`);
            const data = await readMediaResponse(response, limit, signal);
            const type = response.headers["content-type"]?.split(";")[0].trim().toLowerCase() || getMimeType(data);
            const filename = safeMediaFilename(
                /(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^;]+))/i
                    .exec(response.headers["content-disposition"] ?? "")
                    ?.slice(1)
                    .find(Boolean),
            );
            return { data, type, filename };
        } finally {
            response.destroy();
        }
    }
    throw new Error("外部媒体重定向次数超过限制");
}
