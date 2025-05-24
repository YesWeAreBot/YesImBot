import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execSync } from "child_process";
import { Context, Schema } from "koishi";
import { } from "koishi-plugin-yesimbot";


interface Server {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
}

export interface Config {
    timeout: number;
    mcpServers: Record<string, Server>;
    uvSettings?: {
        autoDownload?: boolean;
        mirror: string;
        executablePath?: string;
        args?: string[];
    }
}

export const Config: Schema<Config> = Schema.object({
    timeout: Schema.number().description("请求超时时间").default(5000),
    mcpServers: Schema.dict(Schema.object({
        url: Schema.string().description("MCP 服务器地址"),
        command: Schema.string().description("MCP 启动命令"),
        args: Schema.array(Schema.string()).role("table").description("MCP 启动参数"),
        env: Schema.dict(String).role("table").description("MCP 环境变量"),
    })).description("MCP服务器列表，可使用 `编辑JSON` 添加或删除服务器"),
    uvSettings: Schema.object({
        autoDownload: Schema.boolean().experimental().description("是否自动下载 UVX").default(true),
        mirror: Schema.string().description("Pypi镜像源").default("https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple"),
        executablePath: Schema.string().description("UVX 可执行文件路径").default("uvx"),
        args: Schema.array(Schema.string()).role("table").description("UV 启动参数").default([]),
    }).description("UVX 设置"),
});

export const name = "yesimbot-extension-mcp";

export const inject = {
    required: ["yesimbot"],
}

export async function apply(ctx: Context, config: Config) {
    const clients: Client[] = [];
    const transports: (SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport)[] = [];
    const allTools = [];
    ctx.on("ready", async () => {

        if (config.uvSettings?.autoDownload) {
            // 检查是否已经安装了 UVX，如果没有安装则安装
            // if (!config.uvSettings?.executablePath) {
            //
            // }
        }

        ctx.logger.info(`Connecting to ${Object.keys(config.mcpServers).length} servers`);
        for await (const serverName of Object.keys(config.mcpServers)) {
            let transport: SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport;
            const server = config.mcpServers[serverName];

            if (server.url) {
                transport = new SSEClientTransport(new URL(server.url));
            } else if (server.command) {
                ctx.logger.info(`Starting ${serverName} with command <${server.command} ${server.args.join(" ")}>`);
                if (server.command === "uvx" && config.uvSettings?.executablePath) {
                    server.command = config.uvSettings.executablePath;
                }
                try {
                    transport = installStdio(server.command, server.args, { ...process.env, ...server.env });
                } catch (error) {
                    ctx.logger.error(`Failed to start ${serverName}: ${error.message}`);
                    continue;
                }
            } else {
                ctx.logger.error(`Unknown transport type: ${serverName}`);
                continue;
            }

            const client = new Client({ name: serverName, version: "1.0.0" });
            try {
                await client.connect(transport);
                ctx.logger.info(`Connected to ${serverName}`);
                clients.push(client);
                transports.push(transport);
            } catch (error) {
                ctx.logger.error(`Failed to connect to ${serverName}. Reason: ${error.message}`);
                continue;
            }
        }
        const toolManager = ctx.yesimbot.toolManager;
        for (const client of clients) {
            const tools = await client.listTools();
            for (const tool of tools["tools"]) {
                tool.inputSchema["properties"] = {
                    inner_thoughts: {
                        type: "string",
                        description: "Deep inner monologue private to you only.",
                    },
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
                            const timer = setTimeout(() => {
                                ctx.logger.error(`Request timeout after ${config.timeout}ms`);
                                return {
                                    success: false,
                                    error: `Request timeout after ${config.timeout}ms`,
                                };
                            }, config.timeout);
                            let result = await client.callTool({ name: tool.name, arguments: params });
                            clearTimeout(timer);
                            if (result.isError) {
                                ctx.logger.error(`Failed to call tool ${tool.name}: ${result.error}`);
                                return {
                                    success: false,
                                    error: result.error as string,
                                };
                            }
                            let fullContent = "";
                            for (const element of result.content as any[]) {
                                if (element.type === "text") {
                                    try {
                                        let data = JSON.parse(element.text);
                                        fullContent += JSON.stringify(data);
                                    } catch (error) {
                                        fullContent += element.text;
                                    }
                                }
                            }
                            return {
                                success: true,
                                result: fullContent,
                            };
                        } catch (error) {
                            return {
                                success: false,
                                error: error.message,
                            };
                        }
                    }
                });
                allTools.push(tool.name);
                ctx.logger.info(`Tool registered: ${tool.name}`);
            }
        }
        if (allTools.length === 0) {
            ctx.logger.error(`No tools found`);
            return;
        } else {
            ctx.logger.info(`Loaded ${clients.length} servers with ${allTools.length} tools`);
        }
    })

    ctx.on("dispose", async () => {
        for await (const client of clients) {
            await client.close();
        }

        for await (const transport of transports) {
            await transport.close();
        }

        for (const tool of allTools) {
            ctx.yesimbot.toolManager.removeTool(tool);
        }

        ctx.logger.info(`Disconnected from all servers`);
    })

    function installStdio(command: string, args: string[], env: Record<string, string>, options?: { cwd?: string; }): StdioClientTransport {
        try {
            const version = getVersion(command);
            if (version) {
                return new StdioClientTransport({ command, args, env });
            }
        } catch (error) {
            throw new Error(`${command} is not installed`);
        }
    }
}

function getVersion(executablePath: string) {
    try {
        const output = execSync(`${executablePath} --version`, { encoding: "utf-8" });
        const versionMatch = output.match(/\d+\.\d+\.\d+/);
        if (versionMatch) {
            return versionMatch[0];
        } else {
            throw new Error("Failed to extract version from output");
        }
    } catch (error) {
        throw new Error("Failed to get version");
    }
}
