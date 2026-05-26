import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Context } from "koishi";

import type {
  McpClientTransport,
  McpHttpServer,
  McpServer,
  McpSseServer,
  McpStdioServer,
} from "./types";

export async function connectMcpServer(
  ctx: Context,
  name: string,
  server: McpServer,
): Promise<{ client: Client; transport: McpClientTransport }> {
  ctx.logger.info(`连接到 MCP 服务器 ${name}...`);

  switch (server.type) {
    case "stdio":
      return await connectToStdioServer(ctx, name, server);
    case "http":
      return await connectToHttpServer(ctx, name, server);
    case "sse":
      return await connectToSseServer(ctx, name, server);
  }
}

export function parseKeyValueString(input: string): Record<string, string> {
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

async function connectToStdioServer(
  ctx: Context,
  name: string,
  server: McpStdioServer,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  ctx.logger.info(`连接到 STDIO 服务器 ${name}，命令: ${server.command} ${server.args?.join(" ")}`);

  const env = typeof server.env === "string" ? parseKeyValueString(server.env) : server.env;
  ctx.logger.debug(`环境变量: ${JSON.stringify(env)}`);

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env,
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}

async function connectToHttpServer(
  ctx: Context,
  name: string,
  server: McpHttpServer,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  ctx.logger.info(`连接到 HTTP 服务器 ${name}，URL: ${server.url}`);

  const headers =
    typeof server.headers === "string" ? parseKeyValueString(server.headers) : server.headers || {};
  ctx.logger.debug(`HTTP 请求头: ${JSON.stringify(headers)}`);

  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers,
    },
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}

async function connectToSseServer(
  ctx: Context,
  name: string,
  server: McpSseServer,
): Promise<{ client: Client; transport: SSEClientTransport }> {
  ctx.logger.info(`连接到 SSE 服务器 ${name}，URL: ${server.url}`);

  const headers =
    typeof server.headers === "string" ? parseKeyValueString(server.headers) : server.headers || {};
  ctx.logger.debug(`HTTP 请求头: ${JSON.stringify(headers)}`);

  const transport = new SSEClientTransport(new URL(server.url), {
    requestInit: {
      headers,
    },
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}
