import { afterEach, expect, it, vi } from "vitest";

import { SearchService } from "../src/extension/builtin/search/service";
import type { EngineConfig, SearchConfig } from "../src/extension/builtin/search/types";

const options: SearchConfig = {
    maxLimit: 10,
    timeoutMs: 1000,
    totalTimeoutMs: 2000,
    maxFetchUrls: 3,
    maxContentChars: 100,
    maxSnippetChars: 100,
    maxAnswerChars: 100,
    blacklist: ["blocked\\.test"],
};
const engine = (id: string): EngineConfig => ({
    backend: "searxng",
    id,
    endpoint: `https://${id}.test`,
    apiKey: "",
    timeoutMs: 0,
    categories: ["general"],
    language: "all",
    safesearch: 1,
});

afterEach(() => vi.unstubAllGlobals());

it("tries checked engines in configured order, skipping bad links and empty results", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async (url) =>
        Response.json({ results: [{ title: "hit", url: url.includes("first.test") ? "https://blocked.test/a" : "https://example.test/a" }] }),
    );
    vi.stubGlobal("fetch", fetch);
    const service = new SearchService([engine("first"), engine("unchecked"), engine("second")], ["second", "first"], "auto", options);
    const result = await service.search("Koishi", 5);
    expect(fetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(["first.test", "second.test"]);
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["empty", "success"]);
    expect(result.results.map((hit) => hit.url)).toEqual(["https://example.test/a"]);
});

it("deduplicates concurrent results and returns failures without upstream response bodies", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
        if (url.includes("bad.test")) return new Response("private response body", { status: 429 });
        return Response.json({ results: [{ title: "result", url: url.includes("first.test") ? "https://EXAMPLE.test/a/#top" : "https://example.test/a" }] });
    });
    const service = new SearchService([engine("first"), engine("bad"), engine("second")], ["first", "bad", "second"], "parallel", options);
    const result = await service.search("Koishi", 5);
    expect(result.results).toHaveLength(1);
    expect(result.attempts).toContainEqual({ engine: "bad", status: "failed", count: 0, error: "HTTP 429" });
    expect(JSON.stringify(result)).not.toContain("private response body");
});

it("rejects duplicate or stale names and treats an empty selection as disabled", () => {
    expect(() => new SearchService([engine("first"), engine("first")], [], "auto", options)).toThrow("搜索引擎名称必须非空且唯一");
    expect(() => new SearchService([engine("first")], ["unknown"], "auto", options)).toThrow("请选择仍存在的搜索引擎");
    expect(new SearchService([engine("first")], [], "auto", options).canSearch).toBe(false);
});

it("shares the total timeout across sequential engines", async () => {
    const fetch = vi.fn<(url: string, request: RequestInit) => Promise<Response>>(
        (_url, request) =>
            new Promise((_resolve, reject) => {
                request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true });
            }),
    );
    vi.stubGlobal("fetch", fetch);
    const service = new SearchService([engine("first"), engine("second")], ["first", "second"], "auto", { ...options, totalTimeoutMs: 30 });
    await expect(service.search("Koishi", 5)).rejects.toMatchObject({ retryable: false, attempts: [{ engine: "first", error: "请求超时" }] });
    expect(fetch).toHaveBeenCalledTimes(1);
});
