import { randomUUID } from "node:crypto";

import type { Context } from "koishi";

import { observeModelReportRequest, withModelConversationReport } from "../../../../model/conversation-capture";
import { observeUsageFetch } from "../../../../model/usage";
import type { AnthropicEngineConfig, OpenaiEngineConfig } from "../types.js";

export function nativeSearchFetch(ctx: Context | undefined, config: AnthropicEngineConfig | OpenaiEngineConfig): typeof fetch | undefined {
    if (!ctx) return;
    const source = nativeSearchSource(config);
    return observeModelReportRequest((input, init) => {
        const owner = ctx.get("yesimbot")?.model?.usageOwner;
        return observeUsageFetch(ctx, source, (url, options) => globalThis.fetch(url, options), owner)(input, init);
    });
}

function nativeSearchSource(config: AnthropicEngineConfig | OpenaiEngineConfig) {
    return { provider: config.id, model: config.model, purpose: "原生联网搜索" };
}

export function traceNativeSearch<T>(config: AnthropicEngineConfig | OpenaiEngineConfig, run: () => Promise<T>): Promise<T> {
    return withModelConversationReport({ ...nativeSearchSource(config), requestId: randomUUID() }, run);
}
