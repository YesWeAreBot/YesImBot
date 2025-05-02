///<reference types="bun-types" />
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const API_KEY = process.env.API_KEY_GLM || "";
const SERVER_URL = "https://open.bigmodel.cn/api/mcp/web_search/sse";

const transport1 = new SSEClientTransport(new URL(`${SERVER_URL}?Authorization=${API_KEY}`));
const transport2 = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:3000/mcp`));

const client = new Client(
    { name: "zhipu-web-search-sse", version: "1.0.0" }
);

await client.connect(transport1);

let result = await client.listTools();

for (const tool of result["tools"]) {
    console.log("name:", tool.name);
    console.log("description:", tool.description);
    console.log("parameters:", tool.inputSchema);
}

result = await client.callTool({ name: "web_search", arguments: { search_query: "鹿乃" }});

console.log(result);

await transport1.close();
await transport2.close();
await client.close();





