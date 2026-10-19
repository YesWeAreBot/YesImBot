import { expect, it, vi, type TestContext } from "vitest";

import { MCPManager } from "../src/MCPManager";

const result = (request: any) => ({
    jsonrpc: "2.0",
    id: request.id,
    result:
        request.method === "initialize"
            ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }
            : { tools: [{ name: "remote", inputSchema: { type: "object" } }] },
});

async function fixture(t: TestContext, options: { url?: string; status?: number; failure?: "network" | "timeout" | "tools"; explicit?: boolean } = {}) {
    const calls: Array<{ method: string; url: string; rpc?: string }> = [];
    const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];
    const encoder = new TextEncoder();
    let streamClosed = false;
    const tools = new Map<string, any>();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL | string, init: RequestInit = {}) => {
            const url = new URL(String(input));
            const method = init.method ?? "GET";
            const request = init.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ method, url: url.href, rpc: request?.method });
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("unsupported protocol");
            if (method === "POST" && url.pathname === "/mcp" && request?.method === "initialize") {
                if (options.failure === "network") throw new TypeError("network unavailable");
                if (options.failure === "timeout") {
                    return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
                }
                if (options.status) return new Response("legacy endpoint", { status: options.status });
            }
            if (method === "GET") {
                if (!options.explicit && !options.status) return new Response("no standalone SSE", { status: 405 });
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        streams.push(controller);
                        controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
                    },
                    cancel() {
                        streamClosed = true;
                    },
                });
                init.signal?.addEventListener(
                    "abort",
                    () => {
                        streamClosed = true;
                        try {
                            streams.at(-1)?.close();
                        } catch {}
                    },
                    { once: true },
                );
                return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
            }
            if (request?.method === "tools/list" && options.failure === "tools") return new Response("list failed", { status: 404 });
            if (request?.id === undefined) return new Response(null, { status: 202 });
            if (url.pathname === "/messages") {
                streams.at(-1)!.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(result(request))}\n\n`));
                return new Response(null, { status: 202 });
            }
            return Response.json(result(request));
        }),
    );
    const manager = new MCPManager(
        { schema: { set() {} } } as any,
        { debug() {}, info() {}, warn() {}, success() {}, error() {} } as any,
        {} as any,
        {
            registerTool(tool: any) {
                tools.set(tool.name, tool);
                return () => tools.delete(tool.name);
            },
        } as any,
        { timeout: 100, mcpServers: { remote: { url: options.url ?? "https://mcp.example/mcp" } } } as any,
    );
    t.onTestFinished(async () => {
        await manager.cleanup();
        vi.unstubAllGlobals();
    });
    return { manager, calls, tools, isStreamClosed: () => streamClosed };
}

it("keeps successful HTTPS Streamable HTTP connections on the modern transport", async (t) => {
    const f = await fixture(t);
    await f.manager.connectServers();
    expect(f.tools.has("remote")).toBe(true);
    expect(f.calls.filter((call) => call.rpc === "initialize")).toEqual([{ method: "POST", url: "https://mcp.example/mcp", rpc: "initialize" }]);
    expect(f.calls.some((call) => call.url.endsWith("/messages"))).toBe(false);
    await f.manager.cleanup();
    expect(f.tools.size).toBe(0);
});

it.for([400, 404, 405])("falls back to real SDK SSE on initialize HTTP %i and closes its stream", async (status, t) => {
    const f = await fixture(t, { status });
    await f.manager.connectServers();
    expect(f.tools.has("remote")).toBe(true);
    expect(f.calls.filter((call) => call.rpc === "initialize").map((call) => call.url)).toEqual(["https://mcp.example/mcp", "https://mcp.example/messages"]);
    expect((f.manager as any).clients).toHaveLength(1);
    expect((f.manager as any).transports).toHaveLength(1);
    await f.manager.cleanup();
    expect(f.isStreamClosed()).toBe(true);
    expect(f.tools.size).toBe(0);
});

it("normalizes the explicit legacy sse scheme into HTTP before SDK fetch", async (t) => {
    const f = await fixture(t, { url: "sse://mcp.example/mcp", explicit: true });
    await f.manager.connectServers();
    expect(f.tools.has("remote")).toBe(true);
    expect(f.calls[0]).toMatchObject({ method: "GET", url: "http://mcp.example/mcp" });
});

it.for([401, 403, 500])("does not retry initialization HTTP %i as legacy SSE", async (status, t) => {
    const f = await fixture(t, { status });
    await f.manager.connectServers();
    expect(f.tools.size).toBe(0);
    expect(f.calls).toHaveLength(1);
    expect((f.manager as any).clients).toHaveLength(0);
    expect((f.manager as any).transports).toHaveLength(0);
});

it.for(["network", "timeout"] as const)("does not fall back after an initialization %s failure", async (failure, t) => {
    const f = await fixture(t, { failure });
    await f.manager.connectServers();
    expect(f.tools.size).toBe(0);
    expect(f.calls.filter((call) => call.rpc === "initialize")).toHaveLength(1);
    expect(f.calls.every((call) => call.method === "POST" && call.url === "https://mcp.example/mcp")).toBe(true);
});

it("does not fall back when tools/list fails after successful initialization", async (t) => {
    const f = await fixture(t, { failure: "tools" });
    await f.manager.connectServers();
    expect(f.tools.size).toBe(0);
    expect(f.calls.filter((call) => call.rpc === "initialize")).toHaveLength(1);
    expect(f.calls.some((call) => call.url.endsWith("/messages"))).toBe(false);
});
