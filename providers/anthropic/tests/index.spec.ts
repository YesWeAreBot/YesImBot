import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { jsonSchema, streamText, tool } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";
vi.mock("koishi", async () => import("@koishijs/core"));

import { apply } from "../src/index.js";

type RegisteredProvider = {
  tools?(modelId: string): Record<string, { readonly id?: string; readonly type?: string }>;
  chat(modelId: string): Parameters<typeof streamText>[0]["model"];
};

type PromptCacheBody = {
  cache_control?: { type?: string; ttl?: string };
  system?: Array<{ cache_control?: unknown }>;
  messages?: Array<Record<string, unknown>>;
};

function registerProvider(config: Record<string, unknown>): RegisteredProvider {
  let ready: (() => void) | undefined;
  const model = { register: vi.fn<RegisteredProvider, () => void>((_provider) => () => undefined) };
  const ctx = {
    on(event: string, callback: () => void) {
      if (event === "ready") ready = callback;
    },
    yesimbot: { model },
  };

  apply(ctx as never, config as never);
  if (!ready) throw new Error("provider did not register a ready callback");
  ready();
  return model.register.mock.calls[0]![0];
}

/**
 * Answers Anthropic requests locally and records the bodies the provider actually sent. Streaming is real
 * because caching is only observable on the wire, and the system prefix has to survive a full SDK turn.
 */
async function captureRequests(request: (provider: RegisteredProvider) => Promise<void>): Promise<PromptCacheBody[]> {
  const bodies: PromptCacheBody[] = [];
  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as PromptCacheBody);
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 4096, cache_creation_input_tokens: 0 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await request(registerProvider({ id: "anthropic", apiKey: "test", baseURL: `http://127.0.0.1:${port}`, webSearch: false, chatModels: [] }));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return bodies;
}

describe("Anthropic native web search", () => {
  it("registers web_search when enabled", () => {
    const provider = registerProvider({ id: "anthropic", apiKey: "test", webSearch: true, chatModels: [] });

    expect(provider.tools?.("claude-sonnet")?.web_search).toMatchObject({ type: "provider", id: "anthropic.web_search_20250305" });
  });

  it("omits web_search when disabled", () => {
    const provider = registerProvider({ id: "anthropic", apiKey: "test", webSearch: false, chatModels: [] });

    expect(provider.tools?.("claude-sonnet")).toEqual({});
  });
});

describe("Anthropic prompt cache", () => {
  it("keeps one top-level breakpoint over a prefix that a growing conversation reuses", async () => {
    const bodies = await captureRequests(async (provider) => {
      const messages: Array<{ role: "user"; content: Array<{ type: "text"; text: string }> }> = [];
      for (const turn of ["turn one", "turn two", "turn three"]) {
        messages.push({ role: "user", content: [{ type: "text", text: turn }] });
        const result = streamText({
          model: provider.chat("claude-sonnet-4-6"),
          instructions: "you are Athena",
          messages,
          tools: {
            read: tool({ inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }) }),
          },
        });
        messages.push({ role: "user", content: [{ type: "text", text: `ack ${turn}` }] });
        await result.text;
        await result.usage;
      }
    });

    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body.cache_control).toEqual({ type: "ephemeral" });
      // A single top-level breakpoint must stay the only one, or later turns never reach a cached prefix.
      expect(body.system?.[0]?.cache_control).toBeUndefined();
    }
    expect(JSON.stringify(bodies[0]!.system)).toBe(JSON.stringify(bodies[2]!.system));
    expect(JSON.stringify(bodies[2]!.messages)).toContain("turn one");
  });

  it("leaves the breakpoint off the system blocks so a proxy can still cache the prefix", async () => {
    const [body] = await captureRequests(async (provider) => {
      const result = streamText({
        model: provider.chat("claude-sonnet-4-6"),
        instructions: "you are Athena",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
      await result.text;
      await result.usage;
    });

    expect(body!.cache_control).toEqual({ type: "ephemeral" });
    expect(body!.system).toEqual([{ type: "text", text: "you are Athena", cache_control: undefined }]);
  });
});
