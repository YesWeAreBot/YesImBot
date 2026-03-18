import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  Failed,
  FunctionDefinition,
  FunctionType,
  Metadata,
  YesImPlugin,
  jsonSchemaToSchema,
  Success,
} from "@yesimbot/plugin-sdk/tools";
import { Context, Schema } from "koishi";

interface McpServer {
  type: "stdio" | "http" | "sse";
}

interface McpStdioServer extends McpServer {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string> | string;
}

interface McpHttpServer extends McpServer {
  type: "http";
  url: string;
  headers?: Record<string, string> | string;
}

interface McpSseServer extends McpServer {
  type: "sse";
  url: string;
  headers?: Record<string, string> | string;
}

type Server = McpStdioServer | McpHttpServer | McpSseServer;

type McpClientTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

interface McpClientConfig {
  mcpServers: Record<string, Server>;
}

function parseKeyValueString(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = input.split("\n");
  for (const line of lines) {
    const [key, ...rest] = line.split(/[:=]/);
    if (key && rest.length > 0) {
      result[key.trim()] = rest.join(":").trim();
    }
  }
  return result;
}

@Metadata({ name: "mcp-client", description: "MCP protocol client" })
export default class McpClientPlugin extends YesImPlugin {
  static name = "mcp-client";
  static inject = ["yesimbot.plugin", "yesimbot.hook"];
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

    ctx.on("ready", async () => this.start());
    ctx.on("dispose", async () => this.dispose());
  }

  private async start(): Promise<void> {
    this.ctx.logger.info("初始化 MCP 客户端...");
    for (const [name, server] of Object.entries(this.config.mcpServers)) {
      try {
        await this.connectToMcpServer(name, server);
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
        const functionDef: FunctionDefinition = {
          name: `${name}_${tool.name}`,
          description: tool.description || "no description provided",
          parameters: jsonSchemaToSchema(tool.inputSchema),
          type: FunctionType.Tool,
          hidden: false,
          handler: async (params, ctx) => {
            try {
              const result = await client.callTool({
                name: tool.name,
                arguments: structuredClone(params),
              });
              if (result.isError) {
                return Failed("MCP tool returned an error", {
                  server: name,
                  tool: tool.name,
                  content: result.content,
                });
              }
              return Success(result.content);
            } catch (error) {
              this.ctx.logger.error(`调用工具 ${tool.name} 失败: ${(error as Error).message}`);
              return Failed(`调用工具失败: ${(error as Error).message}`);
            }
          },
        };
        this.registerTool(functionDef);
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

  private async connectToMcpServer(name: string, server: Server): Promise<void> {
    this.ctx.logger.info(`连接到 MCP 服务器 ${name}...`);
    switch (server.type) {
      case "stdio":
        await this.connectToStdioServer(name, server);
        break;
      case "http":
        await this.connectToHttpServer(name, server);
        break;
      case "sse":
        await this.connectToSseServer(name, server);
        break;
    }
  }

  private async connectToStdioServer(name: string, server: McpStdioServer): Promise<void> {
    this.ctx.logger.info(
      `连接到 STDIO 服务器 ${name}，命令: ${server.command} ${server.args?.join(" ")}`,
    );
    const env = typeof server.env === "string" ? parseKeyValueString(server.env) : server.env;
    this.ctx.logger.debug(`环境变量: ${JSON.stringify(env)}`);
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env,
    });
    const client = new Client({ name: name, version: "1.0.0" });
    await client.connect(transport);
    this.transports.set(name, transport);
    this.clients.set(name, client);
  }

  private async connectToHttpServer(name: string, server: McpHttpServer): Promise<void> {
    this.ctx.logger.info(`连接到 HTTP 服务器 ${name}，URL: ${server.url}`);

    const headers =
      typeof server.headers === "string"
        ? parseKeyValueString(server.headers)
        : server.headers || {};
    this.ctx.logger.debug(`HTTP 请求头: ${JSON.stringify(headers)}`);

    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers,
      },
    });
    const client = new Client({ name: name, version: "1.0.0" });
    await client.connect(transport);
    this.transports.set(name, transport);
    this.clients.set(name, client);
  }

  private async connectToSseServer(name: string, server: McpSseServer): Promise<void> {
    this.ctx.logger.info(`连接到 SSE 服务器 ${name}，URL: ${server.url}`);

    const headers =
      typeof server.headers === "string"
        ? parseKeyValueString(server.headers)
        : server.headers || {};
    this.ctx.logger.debug(`HTTP 请求头: ${JSON.stringify(headers)}`);

    const transport = new SSEClientTransport(new URL(server.url), {
      requestInit: {
        headers,
      },
    });
    const client = new Client({ name: name, version: "1.0.0" });
    await client.connect(transport);
    this.transports.set(name, transport);
    this.clients.set(name, client);
  }
}
