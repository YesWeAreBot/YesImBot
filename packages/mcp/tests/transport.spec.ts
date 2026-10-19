import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fetch as localFetch } from "undici";
import { expect, it, vi, onTestFinished } from "vitest";

import { MCPManager } from "../src/MCPManager";

it.each(["http-sse", "sse-alias", "streamable"])("connects and discovers tools over %s", async (mode) => {
    vi.stubGlobal("fetch", localFetch);
    onTestFinished(() => vi.unstubAllGlobals());
    const remote = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } });
    remote.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "remote", inputSchema: { type: "object" } }] }));
    let transport: SSEServerTransport | StreamableHTTPServerTransport | undefined;
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
        requests.push(`${req.method} ${req.url?.split("?")[0]}`);
        if (mode === "streamable") {
            if (!transport) {
                transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
                await remote.connect(transport);
            }
            await (transport as StreamableHTTPServerTransport).handleRequest(req, res);
        } else if (req.method === "GET" && req.url === "/sse") {
            transport = new SSEServerTransport("/messages", res);
            await remote.connect(transport);
        } else if (req.method === "POST" && req.url?.startsWith("/messages")) {
            await (transport as SSEServerTransport).handlePostMessage(req, res);
        } else res.writeHead(405).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as any).port;
    const registerTool = vi.fn<(...args: any[]) => void>();
    const manager = new MCPManager(
        { schema: { set() {} } } as any,
        { debug() {}, error() {}, success() {}, info() {}, warn() {} } as any,
        {} as any,
        { registerTool } as any,
        { timeout: 1000, mcpServers: { test: { url: `${mode === "sse-alias" ? "sse" : "http"}://127.0.0.1:${port}/sse` } } } as any,
    );
    onTestFinished(async () => {
        await manager.cleanup();
        await remote.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await manager.connectServers();
    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "remote" }));
    expect(requests).toContain(mode === "streamable" ? "POST /sse" : "GET /sse");
});

it("closes a pending legacy SSE connection during shutdown", async () => {
    vi.stubGlobal("fetch", localFetch);
    onTestFinished(() => vi.unstubAllGlobals());
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let closed!: () => void;
    const disconnected = new Promise<void>((resolve) => {
        closed = resolve;
    });
    const server = createServer((req, res) => {
        if (req.method === "POST") res.writeHead(405).end();
        else {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.flushHeaders();
            res.on("close", closed);
            entered();
        }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const manager = new MCPManager(
        {} as any,
        { debug() {}, error() {}, success() {}, info() {}, warn() {} } as any,
        {} as any,
        {} as any,
        { timeout: 1000, mcpServers: { test: { url: `http://127.0.0.1:${(server.address() as any).port}/sse` } } } as any,
    );
    onTestFinished(async () => {
        await manager.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const pending = manager.connectServers();
    await started;
    await manager.cleanup();
    await pending;
    await disconnected;
    expect((manager as any).clients).toHaveLength(0);
    expect((manager as any).transports).toHaveLength(0);
});

it.each(["sse", "http"])("times out a %s connection before its SSE endpoint arrives", async (protocol) => {
    vi.stubGlobal("fetch", localFetch);
    onTestFinished(() => vi.unstubAllGlobals());
    let streamClosed = false;
    const server = createServer((req, res) => {
        if (req.method === "POST") res.writeHead(405).end();
        else {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.flushHeaders();
            res.on("close", () => {
                streamClosed = true;
            });
        }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const manager = new MCPManager({} as any, { debug() {}, error() {}, success() {}, info() {}, warn() {} } as any, {} as any, {} as any, {
        timeout: 200,
        mcpServers: { test: { url: `${protocol}://127.0.0.1:${(server.address() as any).port}/sse` } },
    });
    onTestFinished(async () => {
        await manager.cleanup();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const connection = manager.connectServers();
    const finished = await Promise.race([connection.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000))]);
    expect(finished).toBe(true);
    expect((manager as any).clients).toHaveLength(0);
    expect((manager as any).transports).toHaveLength(0);
    // Allow the server to observe the client's socket cancellation.
    await vi.waitFor(() => expect(streamClosed).toBe(true), { timeout: 1000 });
});
