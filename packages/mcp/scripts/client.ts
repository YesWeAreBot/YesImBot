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
const transport3 = new StdioClientTransport({
    "command": "npx",
    "args": ["bilibili-mcp"]
});
const client = new Client(
    { name: "zhipu-web-search-sse", version: "1.0.0" }
);

await client.connect(transport3);

let result = await client.listTools();

for (const tool of result["tools"]) {
    console.log("name:", tool.name);
    console.log("description:", tool.description);
    console.log("parameters:", tool.inputSchema);
}

result = await client.callTool({ name: "bilibili-search", arguments: { keyword: "鹿乃", limit: 1 } });
let fullContent = "";
for (const element of result.content as any[]) {
    if (element.type === "text") {
        fullContent += element.text;
    }
}
console.log(fullContent);

await client.close();





