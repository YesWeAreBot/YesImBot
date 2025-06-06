import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Context } from "koishi";
import { CommandResolver } from "./CommandResolver";
import { Config } from "./Config";
import { Logger } from "./Logger";

// MCP 连接管理器
export class MCPManager {
    private logger: Logger;
    private commandResolver: CommandResolver;
    private toolManager: Context["yesimbot.tool"];
    private config: Config;
    private clients: Client[] = [];
    private transports: (SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport)[] = [];
    private registeredTools: string[] = [];

    constructor(logger: Logger, commandResolver: CommandResolver, toolManager: Context["yesimbot.tool"], config: Config) {
        this.logger = logger;
        this.commandResolver = commandResolver;
        this.toolManager = toolManager;
        this.config = config;
    }

    /**
     * 连接所有 MCP 服务器
     */
    async connectServers(): Promise<void> {
        const serverNames = Object.keys(this.config.mcpServers);
        this.logger.info(`准备连接 ${serverNames.length} 个 MCP 服务器`);

        for (const serverName of serverNames) {
            await this.connectServer(serverName);
        }

        if (this.clients.length === 0) {
            this.logger.error("未能成功连接任何 MCP 服务器");
        } else {
            this.logger.success(`成功连接 ${this.clients.length} 个服务器，注册 ${this.registeredTools.length} 个工具`);
        }
    }

    /**
     * 连接单个 MCP 服务器
     */
    private async connectServer(serverName: string): Promise<void> {
        const server = this.config.mcpServers[serverName];
        let transport: any;

        try {
            // 创建传输层
            if (server.url) {
                this.logger.info(`连接 URL 服务器: ${serverName}`);
                transport = new SSEClientTransport(new URL(server.url));
            } else if (server.command) {
                this.logger.info(`启动命令服务器: ${serverName}`);
                const enableTransform = server.enableCommandTransform ?? this.config.globalSettings?.enableCommandTransform ?? true;

                const [command, args, env] = await this.commandResolver.resolveCommand(
                    server.command,
                    server.args || [],
                    enableTransform,
                    server.env
                );

                transport = new StdioClientTransport({ command, args, env });
            } else {
                this.logger.error(`服务器 ${serverName} 配置无效`);
                return;
            }

            // 创建客户端并连接
            const client = new Client({ name: serverName, version: "1.0.0" });
            await client.connect(transport);

            this.clients.push(client);
            this.transports.push(transport);
            this.logger.success(`已连接服务器: ${serverName}`);

            // 注册工具
            await this.registerTools(client, serverName);
        } catch (error) {
            this.logger.error(`连接服务器 ${serverName} 失败: ${error.message}`);
            if (transport) {
                try {
                    await transport.close();
                } catch (closeError) {
                    this.logger.debug(`关闭传输连接失败: ${closeError.message}`);
                }
            }
        }
    }

    /**
     * 注册工具
     */
    private async registerTools(client: Client, serverName: string): Promise<void> {
        try {
            const toolsResponse = await client.listTools();
            const tools = toolsResponse?.tools || [];

            if (tools.length === 0) {
                this.logger.warn(`服务器 ${serverName} 无可用工具`);
                return;
            }

            for (const tool of tools) {
                await this.registerSingleTool(client, tool, serverName);
            }
        } catch (error) {
            this.logger.error(`注册工具失败: ${error.message}`);
        }
    }

    /**
     * 注册单个工具
     */
    private async registerSingleTool(client: Client, tool: any, serverName: string): Promise<void> {
        // 增强工具模式
        const enhancedSchema = {
            properties: {
                inner_thoughts: {
                    type: "string",
                    description: "Deep inner monologue private to you only.",
                },
                ...tool.inputSchema.properties,
                request_heartbeat: {
                    type: "boolean",
                    description:
                        "Request an immediate heartbeat after function execution. Set to `true` if you want to send a follow-up message or run a follow-up function.",
                },
            },
        };

        this.toolManager.registerTool({
            metadata: {
                name: tool.name,
                version: "1.0.0",
                description: tool.description,
            },
            parameters: enhancedSchema,
            execute: async (params: any) => {
                return await this.executeTool(client, tool.name, params);
            },
        });

        this.registeredTools.push(tool.name);
        this.logger.success(`已注册工具: ${tool.name} (来自 ${serverName})`);
    }

    /**
     * 执行工具
     */
    private async executeTool(client: Client, toolName: string, params: any): Promise<any> {
        let timer: NodeJS.Timeout | null = null;
        let timeoutTriggered = false;

        try {
            // 设置超时
            timer = setTimeout(() => {
                timeoutTriggered = true;
                this.logger.error(`工具 ${toolName} 执行超时 (${this.config.timeout}ms)`);
            }, this.config.timeout);

            this.logger.debug(`执行工具: ${toolName}`);
            const result = await client.callTool({ name: toolName, arguments: params });

            if (timer) clearTimeout(timer);

            if (result.isError) {
                this.logger.error(`工具执行失败: ${result.error}`);
                return { success: false, error: result.error };
            }

            // 处理返回内容
            let content = "";
            if (Array.isArray(result.content)) {
                content = result.content
                    .map((item) => {
                        if (item.type === "text") return item.text;
                        if (item.type === "json") return JSON.stringify(item.json);
                        return JSON.stringify(item);
                    })
                    .join("");
            } else {
                content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
            }

            this.logger.success(`工具 ${toolName} 执行成功`);
            return { success: true, result: content };
        } catch (error) {
            if (timer) clearTimeout(timer);
            this.logger.error(`工具执行异常: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 清理资源
     */
    async cleanup(): Promise<void> {
        this.logger.info("正在清理 MCP 连接...");

        // 注销工具
        for (const toolName of this.registeredTools) {
            try {
                this.toolManager.unregisterTool(toolName);
                this.logger.debug(`注销工具: ${toolName}`);
            } catch (error) {
                this.logger.warn(`注销工具失败: ${error.message}`);
            }
        }

        // 关闭客户端
        for (const client of this.clients) {
            try {
                await client.close();
            } catch (error) {
                this.logger.warn(`关闭客户端失败: ${error.message}`);
            }
        }

        // 关闭传输连接
        for (const transport of this.transports) {
            try {
                await transport.close();
            } catch (error) {
                this.logger.warn(`关闭传输失败: ${error.message}`);
            }
        }

        this.logger.success("MCP 清理完成");
    }
}
