import HTTP from "@cordisjs/plugin-http";
import { Context, type Session } from "koishi";
import { expect, it, onTestFinished, vi } from "vitest";

import SearchExtension from "../src/extension/builtin/search";
import { ToolService } from "../src/extension/service";
import type { ToolCallResult } from "../src/extension/types";
import type { SystemEventData } from "../src/world/types";
import { loggingStub } from "./helpers/yesimbot";

async function fixture(response: (attempt: number, signal: AbortSignal) => Promise<Response>, maxRetry = 1) {
    const requests: Array<{ url: string; signal: AbortSignal }> = [];
    // Keep the real HTTP client's timeout and the registered builtin intact;
    // only replace the external network boundary.
    vi.stubGlobal("fetch", (url: URL, init: RequestInit) => {
        const signal = init.signal!;
        requests.push({ url: String(url), signal });
        return response(requests.length, signal);
    });
    const ctx = new Context();
    ctx.plugin(HTTP);
    onTestFinished(async () => {
        await ctx.stop();
        vi.unstubAllGlobals();
    });
    const events: SystemEventData[] = [];
    const tools = new ToolService(ctx, { advanced: { maxRetry, retryDelay: 0 } } as any, {
        logging: loggingStub(),
        prompt: {} as any,
        world: {
            async recordSystemEvent(event: SystemEventData) {
                events.push(event);
                return true;
            },
        } as any,
    });
    ctx.set("yesimbot", { tool: tools } as any);
    ctx.plugin(SearchExtension, SearchExtension.Config({ endpoint: "https://search.invalid/search", sources: ["bing"], httpTimeout: 5 }));
    await ctx.start();
    expect(tools.getTool("web_search")).toBeDefined();
    const session = { platform: "test", selfId: "bot", channelId: "group", userId: "user", bot: { platform: "test" } } as Session;
    return { invoke: () => tools.invoke("web_search", { query: "Koishi" }, session), requests, events };
}

function waitForTimeout(signal: AbortSignal): Promise<Response> {
    return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

function expectReceipt(events: SystemEventData[], result: ToolCallResult) {
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
        type: "tool-result",
        platform: "test",
        channelId: "group",
        payload: { actor: "model", requester: "user", operation: "web_search", status: result.status },
    });
    expect(JSON.parse(events[0].payload.receipt)).toEqual(JSON.parse(JSON.stringify(result)));
}

it("retries an actual builtin search HTTP timeout and records only the final successful receipt", async () => {
    const f = await fixture(async (attempt, signal) =>
        attempt === 1
            ? waitForTimeout(signal)
            : Response.json({ results: [{ title: "Koishi documentation", url: "https://koishi.invalid/docs", content: "A chatbot framework." }] }),
    );
    const result = await f.invoke();
    expect(result).toMatchObject({ status: "success", result: expect.stringContaining("Koishi documentation") });
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.requests[0].signal.reason.code).toBe("ETIMEDOUT");
    expect(f.requests[1].url).toBe(f.requests[0].url);
    expect(new URL(f.requests[0].url).searchParams.get("q")).toBe("Koishi");
    expectReceipt(f.events, result);
});

it("limits repeated builtin HTTP timeouts to the configured retry budget and records their failure", async () => {
    const f = await fixture((_attempt, signal) => waitForTimeout(signal), 2);
    const result = await f.invoke();
    expect(f.requests).toHaveLength(3);
    expect(result).toMatchObject({ status: "error", error: { message: "搜索请求超时", retryable: true } });
    expectReceipt(f.events, result);
});

it("does not turn a permanent HTTP error mentioning timeout into a retryable search timeout", async () => {
    const f = await fixture(async () => new Response("invalid configuration", { status: 400, statusText: "invalid timeout parameter" }), 2);
    const result = await f.invoke();
    expect(f.requests).toHaveLength(1);
    expect(result).toMatchObject({ status: "error", error: { message: expect.stringContaining("invalid timeout parameter") } });
    expect(result.error?.retryable).not.toBe(true);
    expectReceipt(f.events, result);
});
