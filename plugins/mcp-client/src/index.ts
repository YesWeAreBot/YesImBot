import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Metadata, YesImPlugin } from "@yesimbot/plugin-sdk";
import { Context, Schema } from "koishi";

import { connectMcpServer } from "./adapters/transports";
import type { McpClientConfig, McpClientTransport, McpServer } from "./types";

@Metadata({ name: "mcp-client", description: "MCP protocol client" })
export default class McpClientPlugin extends YesImPlugin {
  static name = "mcp-client";
  static inject = ["yesimbot.plugin"];
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

  private config: McpClientConfig;
  private transports: Map<string, McpClientTransport> = new Map();
  private clients: Map<string, Client> = new Map();
  constructor(ctx: Context, config: McpClientConfig) {
    super(ctx);
    this.config = config;
  }

  override async init(): Promise<void> {
    await this.start();
  }

  override async cleanup(): Promise<void> {
    await this.dispose();
  }

  private async start(): Promise<void> {
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

    for (const [name, client] of this.clients.entries()) {
      const tools = (await client.listTools()).tools;
      this.ctx.logger.info(`MCP 服务器 ${name} 提供的工具: ${tools.map((t) => t.name).join(", ")}`);
      for (const tool of tools) {
        this.ctx.logger.info(`注册工具 ${tool.name} to ${name}_${tool.name}`);
        this.registerTool({
          name: `${name}_${tool.name}`,
          description: tool.description || "no description provided",
          inputSchema: tool.inputSchema,
          execute: async (params) => {
            try {
              const result = await client.callTool({
                name: tool.name,
                arguments: structuredClone(params as Record<string, unknown>),
              });
              return result;
            } catch (error) {
              this.ctx.logger.error(`调用工具 ${tool.name} 失败: ${(error as Error).message}`);
              throw error;
            }
          },
        });
      }
    }

    this.ctx.logger.success("MCP 客户端初始化完成");
  }

  private async dispose(): Promise<void> {
    this.ctx.logger.info("清理 MCP 客户端...");
    for (const [name, client] of this.clients.entries()) {
      try {
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
