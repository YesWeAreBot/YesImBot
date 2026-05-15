import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createListSessionsTool, createSearchSessionTool } from "../src/tools";
import type { SessionContextConfig } from "../src/types";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "session-context-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<SessionContextConfig>): SessionContextConfig {
  return {
    sessionsDir: tmpDir,
    isolation: false,
    defaultLimit: 20,
    maxLimit: 100,
    ...overrides,
  };
}

async function writeJsonl(relPath: string, lines: object[]) {
  const fullPath = join(tmpDir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  await writeFile(fullPath, content, "utf-8");
}

async function writeJson(relPath: string, data: object) {
  const fullPath = join(tmpDir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, JSON.stringify(data), "utf-8");
}

// ============================================================================
// createSearchSessionTool
// ============================================================================

describe("createSearchSessionTool", () => {
  it("returns correct name", () => {
    const tool = createSearchSessionTool(makeConfig(), "test:1");
    expect(tool.name).toBe("search_session");
  });

  it("has description and inputSchema", () => {
    const tool = createSearchSessionTool(makeConfig(), "test:1");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeTruthy();
  });

  it("finds user messages by keyword", async () => {
    await writeJsonl("test:1/current.jsonl", [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:00:00Z",
        content: "hello world",
        details: { senderId: "u1" },
      },
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:01:00Z",
        content: "goodbye",
        details: { senderId: "u2" },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig(), "test:1");
    const result = await tool.execute({ keyword: "hello" });
    expect(result).toHaveProperty("results");
    const searchResult = result as { results: { content: string }[] };
    expect(searchResult.results).toHaveLength(1);
    expect(searchResult.results[0].content).toBe("hello world");
  });

  it("filters tool-call and tool-result messages", async () => {
    await writeJsonl("test:1/current.jsonl", [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:00:00Z",
        content: "user msg",
        details: { senderId: "u1" },
      },
      {
        type: "message",
        timestamp: "2025-01-01T00:01:00Z",
        message: { role: "assistant", content: [{ type: "tool-call", toolName: "foo" }] },
      },
      {
        type: "message",
        timestamp: "2025-01-01T00:02:00Z",
        message: { role: "tool", content: [{ type: "tool-result" }] },
      },
      {
        type: "message",
        timestamp: "2025-01-01T00:03:00Z",
        message: { role: "assistant", content: [{ type: "text", text: "assistant reply" }] },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig(), "test:1");
    const result = await tool.execute({});
    const searchResult = result as { results: { type: string }[] };
    expect(searchResult.results).toHaveLength(2);
    expect(searchResult.results.map((r) => r.type)).toEqual(["user", "assistant"]);
  });

  it("returns error for invalid regex", async () => {
    const tool = createSearchSessionTool(makeConfig(), "test:1");
    const result = await tool.execute({ keyword: "[invalid" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Invalid regex");
  });

  it("respects limit", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({
      type: "custom_message",
      customType: "athena:message",
      timestamp: `2025-01-01T00:${String(i).padStart(2, "0")}:00Z`,
      content: `message ${i}`,
      details: { senderId: "u1" },
    }));
    await writeJsonl("test:1/current.jsonl", lines);

    const tool = createSearchSessionTool(makeConfig(), "test:1");
    const result = await tool.execute({ limit: 5 });
    const searchResult = result as { results: unknown[]; totalMatches: number; truncated: boolean };
    expect(searchResult.results).toHaveLength(5);
    expect(searchResult.truncated).toBe(true);
    expect(searchResult.totalMatches).toBe(50);
  });

  it("clamps limit to maxLimit", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      type: "custom_message",
      customType: "athena:message",
      timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      content: `msg ${i}`,
      details: { senderId: "u1" },
    }));
    await writeJsonl("test:1/current.jsonl", lines);

    const tool = createSearchSessionTool(makeConfig({ maxLimit: 10 }), "test:1");
    const result = await tool.execute({ limit: 999 });
    const searchResult = result as { results: unknown[] };
    expect(searchResult.results).toHaveLength(10);
  });

  it("returns error for missing session file", async () => {
    const tool = createSearchSessionTool(makeConfig(), "test:1");
    const result = await tool.execute({ sessionId: "nonexistent" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("not found");
  });

  it("filters by user", async () => {
    await writeJsonl("test:1/current.jsonl", [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:00:00Z",
        content: "from alice",
        details: { senderId: "alice" },
      },
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:01:00Z",
        content: "from bob",
        details: { senderId: "bob" },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig(), "test:1");
    const result = await tool.execute({ user: "alice" });
    const searchResult = result as { results: { content: string }[] };
    expect(searchResult.results).toHaveLength(1);
    expect(searchResult.results[0].content).toBe("from alice");
  });

  it("enforces isolation mode", async () => {
    await writeJsonl("other:channel/data.jsonl", [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:00:00Z",
        content: "secret",
        details: { senderId: "u1" },
      },
    ]);
    await writeJsonl("test:1/data.jsonl", [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2025-01-01T00:00:00Z",
        content: "visible",
        details: { senderId: "u1" },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig({ isolation: true }), "test:1");
    const result = await tool.execute({ channelKey: "other:channel" });
    const searchResult = result as { results: { content: string }[]; channelKey: string };
    expect(searchResult.channelKey).toBe("test:1");
    expect(searchResult.results).toHaveLength(1);
    expect(searchResult.results[0].content).toBe("visible");
  });
});

// ============================================================================
// createListSessionsTool
// ============================================================================

describe("createListSessionsTool", () => {
  it("returns correct name", () => {
    const tool = createListSessionsTool(makeConfig(), "test:1");
    expect(tool.name).toBe("list_sessions");
  });

  it("has description and inputSchema", () => {
    const tool = createListSessionsTool(makeConfig(), "test:1");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeTruthy();
  });

  it("lists all channels from channel-map.json", async () => {
    await writeJson("channel-map.json", {
      "test:1": "group",
      "test:2": "private",
    });
    await writeJson("test:1/meta.json", { currentSession: "sess-a", lastMessage: "hi" });
    await writeJsonl("test:1/sess-a.jsonl", [
      { type: "session", id: "sess-a", timestamp: "2025-01-01T00:00:00Z" },
    ]);

    const tool = createListSessionsTool(makeConfig(), "test:1");
    const result = await tool.execute({});
    const listResult = result as { channels: { channelKey: string; sessionCount: number }[] };
    expect(listResult.channels).toHaveLength(2);
    const ch1 = listResult.channels.find((c) => c.channelKey === "test:1")!;
    expect(ch1.sessionCount).toBe(1);
  });

  it("lists sessions for a specific channel", async () => {
    await writeJsonl("test:1/sess-a.jsonl", [
      { type: "session", id: "sess-a", timestamp: "2025-01-01T00:00:00Z" },
    ]);
    await writeJsonl("test:1/sess-b.jsonl", [
      { type: "session", id: "sess-b", timestamp: "2025-01-02T00:00:00Z" },
    ]);
    await writeJson("test:1/meta.json", { currentSession: "sess-b" });

    const tool = createListSessionsTool(makeConfig(), "test:1");
    const result = await tool.execute({ channelKey: "test:1" });
    const listResult = result as { sessions: { filename: string }[]; currentSession: string };
    expect(listResult.sessions).toHaveLength(2);
    expect(listResult.currentSession).toBe("sess-b");
  });

  it("returns error for missing channel directory", async () => {
    const tool = createListSessionsTool(makeConfig(), "test:1");
    const result = await tool.execute({ channelKey: "nonexistent:0" });
    expect(result).toHaveProperty("error");
  });

  it("returns error when channel-map.json is missing", async () => {
    const tool = createListSessionsTool(makeConfig(), "test:1");
    const result = await tool.execute({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("channel-map.json");
  });

  it("enforces isolation mode", async () => {
    await writeJson("channel-map.json", { "test:1": "group", "other:2": "group" });

    const tool = createListSessionsTool(makeConfig({ isolation: true }), "test:1");
    const result = await tool.execute({ channelKey: "other:2" });
    const listResult = result as { sessions?: unknown[]; error?: string };
    // In isolation mode, channelKey is forced to current, so listing specific channel
    // should look at test:1, not other:2
    expect(listResult.error).toContain("not found");
  });
});
