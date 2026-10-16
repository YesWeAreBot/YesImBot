import { expect, it, vi } from "vitest";

import { withReplyTurn } from "../../core/src/agent/reply-turn";
import { MCPManager } from "../src/MCPManager";

function fixture(timeout = 1000) {
    const manager = new MCPManager({} as any, { debug() {}, error() {}, success() {}, info() {}, warn() {} } as any, {} as any, {} as any, { timeout } as any);
    const callTool = vi.fn<(...args: any[]) => Promise<any>>((_args, _schema, _options) => new Promise(() => {}));
    return { manager, callTool, execute: () => (manager as any).executeTool({ callTool }, "remote", { value: 1 }) };
}
it("does not submit an MCP request for an already cancelled reply turn", async () => {
    const { callTool, execute } = fixture();
    const turn = new AbortController();
    turn.abort(new Error("turn cancelled"));
    const result = await withReplyTurn(() => true, execute, turn.signal);
    expect(result.status).toBe("error");
    expect(callTool).not.toHaveBeenCalled();
});
it("aborts the SDK request and settles locally when the remote ignores turn cancellation", async () => {
    const { callTool, execute } = fixture();
    const turn = new AbortController();
    const add = vi.spyOn(turn.signal, "addEventListener");
    const remove = vi.spyOn(turn.signal, "removeEventListener");
    const pending = withReplyTurn(() => true, execute, turn.signal);
    expect(callTool).toHaveBeenCalledTimes(1);
    const requestSignal = callTool.mock.calls[0][2].signal as AbortSignal;
    turn.abort(new Error("turn cancelled"));
    const result = await pending;
    expect(result.status).toBe("error");
    expect(requestSignal.aborted).toBe(true);
    expect(remove.mock.calls.some(([event, listener]) => event === "abort" && listener === add.mock.calls[0][1])).toBe(true);
});
it.each(["shutdown", "timeout"] as const)("still cancels MCP requests on %s", async (reason) => {
    const { manager, callTool, execute } = fixture(10);
    const pending = execute();
    if (reason === "shutdown") await manager.cleanup();
    expect((await pending).status).toBe("error");
    expect(callTool.mock.calls[0][2].signal.aborted).toBe(true);
});
it("removes turn listeners after a successful remote response", async () => {
    const { callTool, execute } = fixture();
    callTool.mockImplementation(async () => ({ content: [{ type: "text", text: "done" }] }));
    const turn = new AbortController();
    const add = vi.spyOn(turn.signal, "addEventListener");
    const remove = vi.spyOn(turn.signal, "removeEventListener");
    expect(await withReplyTurn(() => true, execute, turn.signal)).toMatchObject({ status: "success", result: "done" });
    expect(add).toHaveBeenCalled();
    expect(remove.mock.calls.some(([event, listener]) => event === "abort" && listener === add.mock.calls[0][1])).toBe(true);
});

it("propagates turn cancellation through the real SDK to the remote handler", async (t) => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    const server = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } });
    const client = new Client({ name: "test", version: "1" });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    let entered!: () => void, cancelled!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
        cancelled = resolve;
    });
    server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
        entered();
        await new Promise<void>((resolve) =>
            extra.signal.addEventListener(
                "abort",
                () => {
                    cancelled();
                    resolve();
                },
                { once: true },
            ),
        );
        return { content: [] };
    });
    t.onTestFinished(async () => {
        await client.close();
        await server.close();
    });
    await server.connect(remote);
    await client.connect(local);
    const { manager } = fixture();
    const turn = new AbortController();
    const pending = withReplyTurn(
        () => true,
        () => (manager as any).executeTool(client, "remote", {}),
        turn.signal,
    );
    await started;
    turn.abort(new Error("turn cancelled"));
    expect((await pending).status).toBe("error");
    await aborted;
});
