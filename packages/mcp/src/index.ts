import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Context, Schema } from "koishi";
import { ToolManager } from "koishi-plugin-yesimbot";

export interface Config {
    mcpServers: {
        name: string;
        type: "sse" | "http" | "stdio";
        url?: string;
        command?: string;
        args?: string[];
        environment: Record<string, string>;
    }[];
}

export const Config: Schema<Config> = Schema.object({
    mcpServers: Schema.array(
        Schema.intersect([
            Schema.object({
                name: Schema.string().description("服务器名称"),
                type: Schema.union(["sse", "http", "stdio"]).description("连接类型").default("sse"),
                environment: Schema.dict(Schema.string()).role("table").description("环境变量").default({}),
            }),
            Schema.union([
                Schema.object({
                    type: Schema.const("sse"),
                    url: Schema.string().description("服务器URL"),
                }),
                Schema.object({
                    type: Schema.const("http"),
                    url: Schema.string().description("服务器URL"),
                }),
                Schema.object({
                    type: Schema.const("stdio"),
                    command: Schema.string().description("启动命令"),
                    args: Schema.array(Schema.string()).role("table").description("启动命令参数").default([]),
                })
            ])
        ])
    )
        .role("table")
        .description("MCP服务器列表")
});

export const name = "yesimbot-extension-mcp";

export const inject = {
    // required: ["yesimbot"],
}

export async function apply(ctx: Context, config: Config) {
    const clients: Client[] = [];
    ctx.on("ready", async () => {
        ctx.logger.info(`[MCP] Connecting to ${config.mcpServers.length} servers`);
        for await (const server of config.mcpServers) {
            let transport;
            if (server.type === "sse") {
                transport = new SSEClientTransport(new URL(server.url));
            } else if (server.type === "http") {
                transport = new StreamableHTTPClientTransport(new URL(server.url));
            } else if (server.type === "stdio") {
                ctx.logger.info(`[MCP] Starting ${server.name} with command: ${server.command} ${server.args.join(" ")}`);
                ctx.logger.info(`[MCP] This may take a while, please wait`);
                transport = new StdioClientTransport({ command: server.command, args: server.args });
            } else {
                ctx.logger.error(`[MCP] Unknown transport type: ${server.type}`);
                continue;
            }
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
                            let fullContent = "";
                            for (const element of result.content as any[]) {
                                if (element.type === "text") {
                                    fullContent += element.text;
                                }
                            }
                            return fullContent;
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
