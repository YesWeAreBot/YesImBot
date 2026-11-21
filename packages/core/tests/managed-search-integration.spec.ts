import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import HTTP from "@cordisjs/plugin-http";
import { Context } from "koishi";
import { expect, it, onTestFinished, vi } from "vitest";

import SearchExtension from "../src/extension/builtin/search";
import { ToolService } from "../src/extension/service";
import { ConversationReportRecorder, withConversationReport } from "../src/logger/conversation-report";
import { getUsageLedger, withUsageScope } from "../src/model/usage";
import { loggingStub } from "./helpers/yesimbot";

async function setup(selectedEngines: string[], backend: "tavily" | "searxng" | "openai" | "anthropic" = "tavily") {
    const ctx = new Context();
    ctx.plugin(HTTP);
    const tools = new ToolService(ctx, {} as any, { logging: loggingStub(), prompt: {} } as any);
    const usagePath = await mkdtemp(path.join(tmpdir(), "search-usage-"));
    const owner = { context: { baseDir: usagePath } as Context };
    const ledger = getUsageLedger(ctx, owner);
    ctx.set("yesimbot", { tool: tools, model: { usageOwner: owner } } as any);
    ctx.plugin(
        SearchExtension,
        SearchExtension.Config({
            engineSelection: "configured",
            selectedEngines,
            engines: [{ id: "primary", backend, endpoint: "https://primary.test", apiKey: "fake-key" }],
        }),
    );
    onTestFinished(async () => {
        await ctx.stop();
        await ledger.close();
        await rm(usagePath, { recursive: true, force: true });
        vi.unstubAllGlobals();
    });
    await ctx.start();
    return { tools, ledger };
}

it("exposes search and managed fetch through ToolService without a browser", async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Response>((url, init) => {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer fake-key");
        return url.endsWith("/extract")
            ? Response.json({ results: [{ url: "https://example.test/", raw_content: "article body" }] })
            : Response.json({ results: [{ title: "Example", url: "https://example.test/" }] });
    });
    vi.stubGlobal("fetch", fetch);
    const { tools } = await setup(["primary"]);
    expect(await tools.invoke("web_search", { query: "example", limit: 2 })).toMatchObject({
        status: "success",
        result: { results: [{ url: "https://example.test/" }], attempts: [{ engine: "primary", status: "success" }] },
    });
    const fetched = await tools.invoke("fetch_webpage", { urls: ["https://example.test/", "file:///bad"] });
    expect(fetched).toMatchObject({
        status: "success",
        result: { results: [{ engine: "primary", content: "article body" }, { error: expect.any(String) }] },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps an explicit empty selection offline and hides unsupported fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const { tools: disabled } = await setup([], "searxng");
    expect(disabled.getTool("web_search")).toBeUndefined();
    expect(disabled.getTool("fetch_webpage")).toBeUndefined();
    const { tools: searchOnly } = await setup(["primary"], "searxng");
    expect(searchOnly.getTool("web_search")).toBeDefined();
    expect(searchOnly.getTool("fetch_webpage")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
});

it.each([
    { backend: "openai" as const, path: "/responses", type: "web_search" },
    { backend: "anthropic" as const, path: "/messages", type: "web_search_20260318" },
])("sends $backend search through its native protocol", async ({ backend, path, type }) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
        expect(new URL(String(url)).pathname).toBe(path);
        const body = JSON.parse(String(init?.body));
        expect(body.tools).toContainEqual(expect.objectContaining({ type }));
        return Response.json({ error: { message: "fixture request denied" }, usage: { input_tokens: 4, output_tokens: 2 } }, { status: 401 });
    });
    vi.stubGlobal("fetch", fetch);
    const { tools, ledger } = await setup(["primary"], backend);
    const recorder = new ConversationReportRecorder();
    const trace = recorder.start({ platform: "onebot", selfId: "bot", channelId: "group" }, "turn");
    const { receipt, report } = await withConversationReport(trace, async () => ({
        receipt: await withUsageScope({ traceId: "turn", platform: "onebot", botId: "bot", target: "group" }, () =>
            tools.invoke("web_search", { query: "example" }),
        ),
        report: recorder.snapshot(),
    }));
    expect(report?.entries).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ kind: "model.request", data: expect.objectContaining({ provider: "primary", purpose: "原生联网搜索" }) }),
            expect.objectContaining({
                kind: "model.response",
                data: expect.objectContaining({ status: 401, raw: expect.stringContaining("fixture request denied") }),
            }),
        ]),
    );
    expect(receipt).toMatchObject({
        status: "error",
        error: { message: expect.stringContaining("HTTP 401"), retryable: false },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await ledger.snapshot()).records).toEqual([
        expect.objectContaining({
            provider: "primary",
            platform: "onebot",
            botId: "bot",
            target: "group",
            purpose: "原生联网搜索",
            api: expect.objectContaining({ in: 4, out: 2 }),
        }),
    ]);
});
