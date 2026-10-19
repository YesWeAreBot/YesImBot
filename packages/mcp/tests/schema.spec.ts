import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Schema } from "koishi";
import type { ToolDefinition } from "koishi-plugin-yesimbot";
import { expect, it, type TestContext } from "vitest";

import { MCPManager } from "../src/MCPManager";

async function registeredParameters(t: TestContext, property: { type: "integer" | "number"; minimum?: number; maximum?: number }): Promise<Schema> {
    const server = new Server({ name: "schema-test", version: "1" }, { capabilities: { tools: {} } });
    const client = new Client({ name: "schema-test", version: "1" });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: "numeric_tool", inputSchema: { type: "object", properties: { value: property }, required: ["value"] } }],
    }));
    const tools: ToolDefinition[] = [];
    const manager = new MCPManager(
        {} as any,
        { debug() {}, error() {}, success() {}, info() {}, warn() {} } as any,
        {} as any,
        {
            registerTool(tool: ToolDefinition) {
                tools.push(tool);
                return () => {};
            },
        } as any,
        { timeout: 1000, mcpServers: {} },
    );
    t.onTestFinished(async () => {
        await manager.cleanup();
        await client.close();
        await server.close();
    });
    await server.connect(remote);
    await client.connect(local);
    await (manager as any).registerTools(client, "in-memory");
    expect(tools).toHaveLength(1);
    return tools[0].parameters;
}

it("validates MCP integer parameters and their inclusive bounds after registration", async (t) => {
    const parameters = await registeredParameters(t, { type: "integer", minimum: 1, maximum: 3 });
    for (const value of [1, 2, 3]) expect(parameters({ value })).toEqual({ value });
    for (const value of ["2", 1.5, 0, 4]) expect(() => parameters({ value })).toThrow(/expected number/);
});

it("keeps integer values valid when MCP integer bounds are fractional", async (t) => {
    const parameters = await registeredParameters(t, { type: "integer", minimum: -1.5, maximum: 3.5 });
    for (const value of [-1, 0, 3]) expect(parameters({ value })).toEqual({ value });
    for (const value of [-2, -1.5, 0.5, 3.5, 4]) expect(() => parameters({ value })).toThrow(/expected number/);
});

it("preserves fractional MCP number parameters and their inclusive bounds", async (t) => {
    const parameters = await registeredParameters(t, { type: "number", minimum: 0.5, maximum: 2.5 });
    for (const value of [0.5, 1.25, 2.5]) expect(parameters({ value })).toEqual({ value });
    for (const value of ["1.25", 0.25, 2.75]) expect(() => parameters({ value })).toThrow(/expected number/);
});
