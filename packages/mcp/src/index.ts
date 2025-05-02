import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Context, Schema } from "koishi";
import { ToolManager } from "koishi-plugin-yesimbot";

export interface Config {
    mcpServers: {
        name: string;
        url: string;
        environment: Record<string, string>;
        connectOptions?: {
            type: "sse" | "http" | "stdio";
        }
    }[];
}

export const Config: Schema<Config> = Schema.object({
    mcpServers: Schema.array(Schema.object({
        name: Schema.string().description("服务器名称"),
        url: Schema.string().description("服务器地址"),
        environment: Schema.dict(Schema.string()).role("table").description("环境变量").default({}),
        connectOptions: Schema.object({
            type: Schema.union(["sse", "http", "stdio"]).description("连接类型").default("sse"),
        })
    }))
        .role("table")
        .description("MCP服务器列表")
});

export const name = "yesimbot-extension-mcp";

export const inject = {
    // required: ["yesimbot"],
}

const transportMap = {
    sse: SSEClientTransport,
    http: StreamableHTTPClientTransport,
    // stdio: StdioClientTransport,
}

export async function apply(ctx: Context, config: Config) {
    const clients: Client[] = [];
    ctx.on("ready", async () => {
        ctx.logger.info(`[MCP] Connecting to ${config.mcpServers.length} servers`);
        for await (const server of config.mcpServers) {
            const transport = new transportMap[server.connectOptions?.type || "sse"](new URL(server.url));
            const client = new Client({ name: server.name, version: "1.0.0" });
            try {
                await client.connect(transport);
                ctx.logger.info(`[MCP] Connected to ${server.name}`);
                clients.push(client);
            } catch (error) {
                ctx.logger.error(`[MCP] Failed to connect to ${server.name}: ${error.message}`);
                continue;
            }
        }
        const toolManager = ToolManager.getInstance();
        for (const client of clients) {
            const tools = await client.listTools();
            for (const tool of tools["tools"]) {
                tool.inputSchema["properties"] = {
                    ...tool.inputSchema["properties"],
                    request_heartbeat: {
                        type: "boolean",
                        description: "Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.",
                    }
                }
                toolManager.registerTool({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                    execute: async (params, context) => {
                        try {
                            let result = await client.callTool({ name: tool.name, arguments: params });
                            if (result.isError) {
                                return { error: `${tool.name} is currently unavailable.` };
                            }
                            return result.content;
                        } catch (error) {
                            return { error: error.message };
                        }
                    }
                });
                ctx.logger.info(`[MCP] Tool registered: ${tool.name}`);
            }
        }
    })

    ctx.on("dispose", async () => {
        for (const client of clients) {
            await client.close();
        }
    })
}
