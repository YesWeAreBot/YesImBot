import { Context } from "koishi";

import { estimateTokensByRegex } from "../shared/utils/toolkit";
import { resolveUsageOwner, UsageOwner } from "./usage-owner";

export interface ContextSnapshot {
    timestamp: number;
    period: string;
    adapter?: string;
    bot?: string;
    target?: string;
    provider: string;
    model: string;
    purpose?: string;
    inputTokens?: number;
    content?: string;
    unavailable?: string;
}

const stores = new WeakMap<object, Map<string, ContextSnapshot>>();
const MAX_ENTRIES = 128;
export const MAX_CONTEXT_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
// A Context inherited by a command and a provider must resolve the same instance.
function owner(ctx: Context, explicitOwner?: UsageOwner): object {
    return resolveUsageOwner(ctx, explicitOwner) ?? ctx;
}

export function captureContextSnapshot(
    ctx: Context,
    metadata: { platform?: string; botId?: string; target?: string; provider: string; model: string; purpose?: string },
    payload: unknown,
    period: string,
    unavailable?: string,
    explicitOwner?: UsageOwner,
): void {
    const identity = owner(ctx, explicitOwner);
    let store = stores.get(identity);
    if (!store) stores.set(identity, (store = new Map()));
    const key = JSON.stringify([metadata.platform, metadata.botId, metadata.target, metadata.provider, metadata.model, metadata.purpose]);
    const snapshot: ContextSnapshot = {
        timestamp: Date.now(),
        period,
        adapter: metadata.platform,
        bot: metadata.botId,
        target: metadata.target,
        provider: metadata.provider,
        model: metadata.model,
        purpose: metadata.purpose,
    };
    if (unavailable) snapshot.unavailable = unavailable;
    else
        try {
            const body = typeof payload === "string" ? JSON.parse(payload) : payload;
            // Transport credentials are not context. Message/tool contents remain unchanged.
            const contextBody =
                body && typeof body === "object" && !Array.isArray(body)
                    ? Object.fromEntries(Object.entries(body).filter(([key]) => !/^(?:api_?key|authorization|access_?token|headers)$/i.test(key)))
                    : body;
            const content = JSON.stringify(contextBody);
            if (typeof content !== "string") snapshot.unavailable = "请求上下文无法序列化";
            else if (Buffer.byteLength(content, "utf8") > MAX_CONTEXT_SNAPSHOT_BYTES) snapshot.unavailable = "请求上下文超过单条快照容量，未保留正文";
            else {
                snapshot.content = content;
                let multimodal = false;
                const input = contextBody as any;
                const context = input?.messages
                    ? { messages: input.messages, tools: input.tools, response_format: input.response_format }
                    : (input?.input ?? { state: input?.state, questions: input?.questions });
                const text = JSON.stringify(context, (_key, value) => {
                    if (value && typeof value === "object" && ["image_url", "input_audio", "image", "audio", "video"].includes(value.type)) multimodal = true;
                    return value;
                });
                if (!multimodal && text !== undefined) snapshot.inputTokens = estimateTokensByRegex(text);
            }
        } catch {
            snapshot.unavailable = "请求上下文无法序列化";
        }
    store.delete(key);
    store.set(key, snapshot);
    let bytes = [...store.values()].reduce((sum, row) => sum + Buffer.byteLength(row.content ?? "", "utf8"), 0);
    while (store.size > MAX_ENTRIES || bytes > MAX_TOTAL_BYTES) {
        const oldest = store.keys().next().value!;
        bytes -= Buffer.byteLength(store.get(oldest)?.content ?? "", "utf8");
        store.delete(oldest);
    }
}

export function getContextSnapshots(ctx: Context, explicitOwner?: UsageOwner): ContextSnapshot[] {
    return [...(stores.get(owner(ctx, explicitOwner))?.values() ?? [])].map((snapshot) => ({ ...snapshot }));
}

export function clearContextSnapshots(ctx: Context, explicitOwner?: UsageOwner): void {
    stores.delete(owner(ctx, explicitOwner));
}
