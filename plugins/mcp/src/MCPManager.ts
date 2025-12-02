/* eslint-disable no-case-declarations */
import type { Context, Logger } from "koishi";
import type { PluginService } from "koishi-plugin-yesimbot/services";
import type { CommandResolver } from "./CommandResolver";
import type { Config } from "./Config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Schema } from "koishi";
import { Failed, FunctionType, Plugin } from "koishi-plugin-yesimbot/services";

// MCP 连接管理器
export class MCPManager {
    private ctx: Context;
    private logger: Logger;
    private commandResolver: CommandResolver;
    private pluginService: PluginService;
    private config: Config;
    private clients: Client[] = [];
    private transports: (SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport)[] = [];
    private registeredTools: string[] = []; // 已注册工具
    private availableTools: string[] = []; // 所有可用工具

    private plugin: Plugin;

    constructor(ctx: Context, logger: Logger, commandResolver: CommandResolver, pluginService: PluginService, config: Config) {
        this.ctx = ctx;
        this.logger = logger;
        this.commandResolver = commandResolver;
        this.pluginService = pluginService;
        this.config = config;

        this.plugin = new (class extends Plugin {
            static metadata = {
                name: "MCP",
                description: "MCP 连接管理器",
            };
        })(ctx, this.config);

        this.pluginService.register(this.plugin, true, this.config);
    }

    /**
     * 连接所有 MCP 服务器
     */
    public async connectServers(): Promise<void> {
        const serverNames = Object.keys(this.config.mcpServers);

        if (serverNames.length === 0) {
            this.logger.info("未配置 MCP 服务器，跳过连接");
            return;
        }

        this.logger.info(`准备连接 ${serverNames.length} 个 MCP 服务器`);

        await Promise.all(serverNames.map((serverName) => this.connectServer(serverName)));

        if (this.clients.length === 0) {
            this.logger.error("未能成功连接任何 MCP 服务器");
        } else {
            this.registeredTools = Array.from(new Set(this.registeredTools));
            this.availableTools = Array.from(new Set(this.availableTools));

            this.ctx.schema.set(
                "extension.mcp.availableTools",
                Schema.array(Schema.union(this.availableTools.map((tool) => Schema.const(tool).description(tool))))
                    .role("checkbox")
                    .collapse()
                    .default(this.availableTools),
            );

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
                if (server.url.includes("http://") || server.url.includes("https://")) {
                    transport = new StreamableHTTPClientTransport(new URL(server.url));
                } else if (server.url.includes("sse://")) {
                    transport = new SSEClientTransport(new URL(server.url));
                } else {
                    this.logger.error(`不支持的服务器 URL: ${server.url}`);
                    return;
                }

                this.logger.debug(`连接 URL 服务器: ${serverName}`);
            } else if (server.command) {
                this.logger.debug(`启动命令服务器: ${serverName}`);
                const enableTransform = server.enableCommandTransform ?? this.config.globalSettings?.enableCommandTransform ?? true;

                const [command, args, env] = await this.commandResolver.resolveCommand(
                    server.command,
                    server.args || [],
                    enableTransform,
                    server.env,
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
        } catch (error: any) {
            this.logger.error(`连接服务器 ${serverName} 失败: ${error.message}`);
            if (transport) {
                try {
                    await transport.close();
                } catch (error: any) {
                    this.logger.debug(`关闭传输连接失败: ${error.message}`);
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
                this.availableTools.push(tool.name);

                if (Object.hasOwn(this.config, "activeTools") && !this.config.activeTools.includes(tool.name)) {
                    this.logger.info(`跳过注册工具: ${tool.name} (来自 ${serverName})`);
                    continue;
                }

                this.plugin.addTool(
                    {
                        name: tool.name,
                        description: tool.description,
                        type: FunctionType.Tool,
                        parameters: convertJsonSchemaToSchemastery(tool.inputSchema),
                    },
                    async (args: any) => {
                        const { session, ...cleanArgs } = args;
                        return await this.executeTool(client, tool.name, cleanArgs);
                    },
                );

                this.registeredTools.push(tool.name);
                this.logger.success(`已注册工具: ${tool.name} (来自 ${serverName})`);
            }
        } catch (error: any) {
            this.logger.error(`注册工具失败: ${error.message}`);
        }
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
                return Failed("工具执行超时");
            }, this.config.timeout);

            this.logger.debug(`执行工具: ${toolName}`);

            const parser = { parse: (data: any) => data };
            const result = await client.callTool({ name: toolName, arguments: params }, parser as any, { timeout: this.config.timeout });

            if (timer)
                clearTimeout(timer);

            // 处理返回内容
            let content = "";
            if (Array.isArray(result.content)) {
                content = result.content
                    .map((item) => {
                        if (item.type === "text")
                            return item.text;
                        else if (item.type === "json")
                            return JSON.stringify(item.json);
                        else return JSON.stringify(item);
                    })
                    .join("");
            } else {
                content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
            }

            if (result.isError) {
                const errorMsg = (result.error as string) || content;
                this.logger.error(`工具执行失败: ${errorMsg}`);
                return Failed(errorMsg);
            }

            this.logger.success(`工具 ${toolName} 执行成功`);
            return { status: "success", result: content as any };
        } catch (error: any) {
            if (timer)
                clearTimeout(timer);
            this.logger.error(`工具执行异常: ${error.message}`);
            this.logger.error(error);
            return Failed(error.message);
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
                // this.pluginService.unregisterTool(toolName);
                this.logger.debug(`注销工具: ${toolName}`);
            } catch (error: any) {
                this.logger.warn(`注销工具失败: ${error.message}`);
            }
        }

        // 关闭客户端
        for await (const client of this.clients) {
            try {
                await client.close();
            } catch (error: any) {
                this.logger.warn(`关闭客户端失败: ${error.message}`);
            }
        }

        // 关闭传输连接
        for await (const transport of this.transports) {
            try {
                await transport.close();
            } catch (error: any) {
                this.logger.warn(`关闭传输失败: ${error.message}`);
            }
        }

        this.logger.success("MCP 清理完成");
    }
}

/**
 * 将 JSON Schema 对象递归转换为 Schemastery 模式。
 *
 * @param {object} jsonSchema 要转换的 JSON Schema。
 * @returns {Schema} 对应的 Schemastery 模式实例。
 */
function convertJsonSchemaToSchemastery(jsonSchema: any): Schema<any> {
    let schema: Schema<any>;

    // 1. 处理 `enum` - 它的优先级最高，直接转换为 union 类型
    if (jsonSchema.enum) {
        schema = Schema.union(jsonSchema.enum);
    } else {
        // 2. 根据 `type` 属性处理主要类型
        switch (jsonSchema.type) {
            case "string":
                schema = Schema.string();
                break;

            case "number":
                schema = Schema.number();
                const { minimum, maximum } = jsonSchema;
                if (typeof minimum === "number" || typeof maximum === "number") {
                    if (minimum !== undefined) {
                        schema = schema.min(minimum);
                    }
                    if (maximum !== undefined) {
                        schema = schema.max(maximum);
                    }
                }
                break;

            case "boolean":
                schema = Schema.boolean();
                break;

            case "array":
                // 递归转换 'items' 定义的子模式
                const itemSchema = jsonSchema.items ? convertJsonSchemaToSchemastery(jsonSchema.items) : Schema.any();
                schema = Schema.array(itemSchema);
                break;

            case "object":
                const properties = jsonSchema.properties || {};
                const requiredFields = new Set(jsonSchema.required || []);
                const schemasteryProperties = {};

                // 遍历所有属性，递归转换它们，并根据需要应用 .required()
                for (const key in properties) {
                    let propSchema = convertJsonSchemaToSchemastery(properties[key]);
                    if (requiredFields.has(key)) {
                        propSchema = propSchema.required();
                    }
                    schemasteryProperties[key] = propSchema;
                }
                schema = Schema.object(schemasteryProperties);
                break;

            default:
                // 如果类型未指定或未知，默认为 any
                schema = Schema.any();
                break;
        }
    }

    // 3. 应用通用修饰器（description 和 default）
    if (jsonSchema.description) {
        schema = schema.description(jsonSchema.description);
    }

    if (jsonSchema.default !== undefined) {
        schema = schema.default(jsonSchema.default);
    }

    return schema;
}
