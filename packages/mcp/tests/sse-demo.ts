///<reference types="bun-types" />
import { EventSource } from "eventsource";


const API_KEY = process.env.API_KEY_GLM || "";
const SERVER_URL = "https://open.bigmodel.cn/api/mcp/web_search/sse";

class Client {
    url: URL;
    endpoint: URL;
    headers: Headers;
    eventSource: EventSource;
    requestMessageId = 0;
    constructor(url: URL) {
        this.url = url;
    }

    async auth() {
        return new Promise((resolve, reject) => {
            this.eventSource = new EventSource(this.url);
            this.eventSource.addEventListener("endpoint", (event) => {
                this.endpoint = new URL(event.data, new URL(SERVER_URL));
                this.headers = new Headers();
                this.headers.set("Authorization", `Bearer ${API_KEY}`);
                resolve(void 0);
            });
        })
    }

    async initialize() {
        return await this.send({ method: "initialize" });
    }

    async notificationsInitialized() {
        return await this.send({ method: "notifications/initialized" });
    }

    async listTools() {
        return await this.send({ method: "tools/list" });
    }

    async send(message: { method: string; params?: Record<string, unknown>; }) {
        const init = {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({
                ...message,
                jsonrpc: "2.0",
                id: this.requestMessageId++,
            }),
        };
        const response = await fetch(this.endpoint, init);
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error("Unauthorized");
            }
            const text = await response.text().catch(() => null);
            throw new Error(`Error POSTing to endpoint (HTTP ${response.status}): ${text}`);
        }
    }
}

const client = new Client(new URL(`${SERVER_URL}?Authorization=${API_KEY}`));

await client.auth();
console.log("auth success");

await client.initialize();
console.log("initialize success");

await client.notificationsInitialized();
console.log("notifications/initialized success");

let result = await client.listTools();
console.log(result);
// es.addEventListener("endpoint", async (event) => {
//     let endpoint = new URL(event.data, new URL(SERVER_URL));
//     const headers = new Headers();
//     headers.set("Authorization", `Bearer ${API_KEY}`);
//     headers.set("Content-Type", "application/json");
//     const init = {
//         method: "POST",
//         headers,
//         body: JSON.stringify({
//             method: "initialize",
//             jsonrpc: "2.0",
//             id: 1
//         }),
//     };
//     let result = await fetch(endpoint, init);
//     console.log("initialize", await result.text());

//     init.body = JSON.stringify({
//         method: "notifications/initialized",
//         jsonrpc: "2.0",
//     });
//     result = await fetch(endpoint, init);
//     console.log("notifications/initialized", await result.text());

//     init.body = JSON.stringify({
//         method: "tools/list",
//         params: { name: "web_search", arguments: { search_query: "MCP" } },
//         jsonrpc: "2.0",
//         id: 2
//     });
//     result = await fetch(endpoint, init);
//     console.log("tools/list", await result.text());

//     es.close();
// });