import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseJsonlLineDetailed, readJsonlWindow, scanJsonlFile } from "../src/jsonl-parser";
import { writeJsonl } from "./helpers";

describe("jsonl-parser", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-context-jsonl-"));
    filePath = join(tempDir, "session.jsonl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("classifies skipped tool and session_info lines", () => {
    expect(
      parseJsonlLineDetailed(
        JSON.stringify({
          type: "message",
          timestamp: "2026-05-15T12:00:00.000Z",
          message: { role: "assistant", content: [{ type: "tool-call", toolName: "grep" }] },
        }),
      ),
    ).toEqual({ skipped: "toolCall" });

    expect(parseJsonlLineDetailed(JSON.stringify({ type: "session_info" }))).toEqual({
      skipped: "sessionInfo",
    });
  });

  it("aggregates filtered counters while scanning", async () => {
    await writeJsonl(tempDir, "session.jsonl", [
      { type: "session", id: "current", timestamp: "2026-05-15T12:00:00.000Z" },
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:01.000Z",
        content: "hello world",
        details: { senderId: "alice" },
      },
      {
        type: "message",
        timestamp: "2026-05-15T12:00:02.000Z",
        message: { role: "assistant", content: [{ type: "tool-call", toolName: "bash" }] },
      },
      {
        type: "message",
        timestamp: "2026-05-15T12:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "reply" }] },
      },
    ]);

    const result = await scanJsonlFile(filePath, {
      messageTypes: new Set(["user", "assistant"]),
    });

    expect(result.entries).toHaveLength(2);
    expect(result.filtered.toolCall).toBe(1);
    expect(result.filtered.toolResult).toBe(0);
  });

  it("reads window around anchor timestamp", async () => {
    await writeJsonl(tempDir, "session.jsonl", [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:00.000Z",
        content: "before",
        details: { senderId: "alice" },
      },
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:01.000Z",
        content: "anchor",
        details: { senderId: "alice" },
      },
      {
        type: "message",
        timestamp: "2026-05-15T12:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "after" }] },
      },
    ]);

    const result = await readJsonlWindow(filePath, {
      anchorTimestamp: "2026-05-15T12:00:01.000Z",
      before: 1,
      after: 1,
      messageTypes: new Set(["user", "assistant"]),
    });

    expect(result.anchorFound).toBe(true);
    expect(result.window.map((entry) => entry.content)).toEqual(["before", "anchor", "after"]);
  });
});
