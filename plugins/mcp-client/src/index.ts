import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { jsonSchema, JSONSchema7 } from "@yesimbot/agent/ai";
import { Context, Schema, Service } from "koishi";
import type { ExtensionAPI, ToolDefinition } from "koishi-plugin-yesimbot";

import { connectMcpServer } from "./transports";
import type { McpClientConfig, McpClientTransport } from "./types";

export default class McpClientPlugin extends Service<McpClientConfig> {
  static name = "mcp-client";
  static inject = ["yesimbot.extension"];
  static Config: Schema<McpClientConfig> = Schema.object({
    mcpServers: Schema.dict(
      Schema.intersect([
        Schema.object({
          type: Schema.union(["stdio", "http", "sse"]),
        }),
        Schema.union([
          Schema.object({
            type: Schema.const("stdio").required(),
            command: Schema.string().required(),
            args: Schema.array(Schema.string()).default([]).role("table"),
            env: Schema.union([
              Schema.dict(Schema.string()).default({}).role("table").description("字典"),
              Schema.string().role("textarea").description("字符串，格式为 KEY=VALUE，每行一个"),
            ]).description("环境变量"),
          }),
          Schema.object({
            type: Schema.const("http").required(),
            url: Schema.string().required(),
            headers: Schema.union([
              Schema.dict(Schema.string()).default({}).role("table").description("字典"),
              Schema.string().role("textarea").description("字符串，格式为 KEY: VALUE，每行一个"),
            ]).description("HTTP 请求头"),
          }),
          Schema.object({
            type: Schema.const("sse").required(),
            url: Schema.string().required(),
            headers: Schema.union([
              Schema.dict(Schema.string()).default({}).role("table").description("字典"),
              Schema.string().role("textarea").description("字符串，格式为 KEY: VALUE，每行一个"),
            ]).description("HTTP 请求头"),
          }),
        ]),
      ]).collapse(true),
    ),
  });

  private transports: Map<string, McpClientTransport> = new Map();
  private clients: Map<string, Client> = new Map();
  constructor(ctx: Context, config: McpClientConfig) {
    super(ctx, config);
    this.config = config;
  }

  override async start(): Promise<void> {
    this.ctx.logger.info("初始化 MCP 客户端...");
    for (const [name, server] of Object.entries(this.config.mcpServers)) {
      try {
        const { client, transport } = await connectMcpServer(this.ctx, name, server);
        this.transports.set(name, transport);
        this.clients.set(name, client);
        this.ctx.logger.success(`成功连接到 MCP 服务器 ${name}`);
      } catch (error) {
        this.ctx.logger.error(`连接到 MCP 服务器 ${name} 失败: ${(error as Error).message}`);
      }
    }

    const registry = new Map<string, { client: Client; tools: ToolDefinition[] }>();

    this.ctx.logger.info("注册 MCP 客户端工具...");
    for (const [name, client] of this.clients.entries()) {
      const resp = await client.listTools();
      const tools = resp.tools;
      this.ctx.logger.info(`MCP 服务器 ${name} 提供的工具: ${tools.map((t) => t.name).join(", ")}`);
      const toolDefs: ToolDefinition[] = tools.map((tool) => ({
        name: `${name}_${tool.name}`,
        description: tool.description || "no description provided",
        inputSchema: jsonSchema(tool.inputSchema as unknown as JSONSchema7),
        execute: async (params: unknown) => {
          try {
            const result = await client.callTool({
              name: tool.name,
              arguments: structuredClone(params as Record<string, unknown>),
            });
            return result.content;
          } catch (error) {
            this.ctx.logger.error(`调用工具 ${tool.name} 失败: ${(error as Error).message}`);
            throw error;
          }
        },
      }));
      registry.set(name, { client, tools: toolDefs });
    }

    this.ctx["yesimbot.extension"].registerExtension({
      id: "mcp-client",
      setup: (api: ExtensionAPI) => {
        for (const [name, { client: _client, tools }] of registry.entries()) {
          for (const tool of tools) {
            this.ctx.logger.info(`注册工具 ${tool.name} from ${name}_${tool.name}`);
            api.registerTool(tool);
          }
        }

        return {
          dispose: () => {
            this.ctx.logger.info("MCP client extension disposed, tools auto-cleaned");
          },
        };
      },
    });

    this.ctx.logger.success("MCP 客户端初始化完成");
  }

  override async stop(): Promise<void> {
    this.ctx.logger.info("清理 MCP 客户端...");
    this.ctx["yesimbot.extension"].unregisterExtension("mcp-client");
    for (const [name, client] of this.clients.entries()) {
      try {
        await client.close();
        this.ctx.logger.success(`成功断开 MCP 服务器 ${name}`);
      } catch (error) {
        this.ctx.logger.error(`断开 MCP 服务器 ${name} 失败: ${(error as Error).message}`);
      }
    }
    for (const [name, transport] of this.transports.entries()) {
      try {
        await transport.close();
        this.ctx.logger.success(`成功关闭传输 ${name}`);
      } catch (error) {
        this.ctx.logger.error(`关闭传输 ${name} 失败: ${(error as Error).message}`);
      }
    }
    this.ctx.logger.success("MCP 客户端已清理");
  }
}
