import { randomUUID } from "node:crypto";

export type Json = Record<string, any>;
export type NativeProtocol = "gemini-native" | "anthropic-native";

/** Opaque native parts travel with the tool ID through xsai's message history. */
export function toolId(protocol: NativeProtocol, nativeId: string | undefined, parts: Json[]): string {
    if (protocol === "anthropic-native" && !nativeId) throw new Error("Anthropic 原生工具调用缺少 ID");
    // The nonce identifies an ID-less call locally; it must never become a native function ID.
    return `yib-native:${Buffer.from(JSON.stringify({ protocol, id: nativeId, nonce: nativeId === undefined ? randomUUID() : undefined, parts }), "utf8").toString("base64url")}`;
}
export function toolData(id: string, protocol: NativeProtocol): { id?: string; parts: Json[] } {
    if (!id?.startsWith("yib-native:")) return { id, parts: [] };
    try {
        const value = JSON.parse(Buffer.from(id.slice(11), "base64url").toString("utf8"));
        if (value.protocol !== protocol || !Array.isArray(value.parts)) throw new Error();
        if (typeof value.id !== "string" && !(protocol === "gemini-native" && value.id === undefined && typeof value.nonce === "string")) throw new Error();
        return value;
    } catch {
        throw new Error("原生工具调用标识无效或接入协议不匹配");
    }
}
export function rejectUnknown(body: Json, allowed: string[]) {
    for (const key of Object.keys(body)) {
        if (body[key] !== undefined && !allowed.includes(key)) throw new Error(`原生接入不支持参数 ${key}，请使用支持的原生参数或兼容协议`);
    }
}
export function partsOf(content: unknown): Json[] {
    if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
    if (content == null) return [];
    if (Array.isArray(content)) return content;
    throw new Error("原生接入不支持此消息内容格式");
}
export function inlineImage(url: string): { mimeType: string; data: string } | undefined {
    const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (match) return { mimeType: match[1], data: match[2] };
}
export const choice = (delta: Json, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
export function completed(message: Json, finish: string, usage: Json, id?: string): Json {
    return {
        id: id ?? randomUUID(),
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
        usage,
    };
}
export function safeToolArguments(value: string): Json {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("原生工具参数必须为 JSON 对象");
    return parsed;
}
/** One-event SSE parser. Output remains pull-driven and cancellation reaches the source. */
export function nativeSSE(response: Response, consume: (data: Json) => Json[], finish: () => Json[]): Response {
    if (!response.body) throw new Error("原生接口返回了空响应体");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let ended = false;
    const queue: Uint8Array[] = [];
    const enqueue = (chunks: Json[]) => {
        for (const item of chunks) queue.push(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
    };
    const event = (block: string) => {
        const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /, ""))
            .join("\n");
        if (!data || data === "[DONE]") return;
        const parsed = JSON.parse(data);
        if (parsed.error || parsed.type === "error") throw new Error(`原生接口流错误: ${parsed.error?.message ?? parsed.message ?? "未知错误"}`);
        enqueue(consume(parsed));
    };
    return new Response(
        new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    while (!queue.length && !ended) {
                        const next = await reader.read();
                        buffer += decoder.decode(next.value, { stream: !next.done });
                        let match: RegExpExecArray | null;
                        while ((match = /\r?\n\r?\n/.exec(buffer))) {
                            const block = buffer.slice(0, match.index);
                            buffer = buffer.slice(match.index + match[0].length);
                            event(block);
                        }
                        if (next.done) {
                            ended = true;
                            if (buffer.trim()) event(buffer);
                            enqueue(finish());
                            queue.push(encoder.encode("data: [DONE]\n\n"));
                        }
                    }
                    if (queue.length) controller.enqueue(queue.shift()!);
                    else controller.close();
                } catch (error) {
                    ended = true;
                    await reader.cancel(error).catch(() => {});
                    controller.error(error);
                }
            },
            async cancel(reason) {
                ended = true;
                await reader.cancel(reason);
            },
        }),
        {
            status: response.status,
            headers: {
                "content-type": "text/event-stream",
                ...(response.headers.get("request-id") ? { "request-id": response.headers.get("request-id")! } : {}),
            },
        },
    );
}
