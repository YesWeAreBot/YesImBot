import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSearchSessionTool } from "../../../src/extension/session-context/tools";
import { SessionContextConfig } from "../../../src/extension/session-context/types";
import { writeChannelFixture, writeJsonl } from "./helpers";

async function mergeChannelMap(
  baseDir: string,
  entries: Record<string, { platform: string; channel: string }>,
) {
  const mapPath = join(baseDir, "channel-map.json");
  let existing: Record<string, { platform: string; channel: string }> = {};
  try {
    existing = JSON.parse(await readFile(mapPath, "utf-8"));
  } catch {}
  await writeFile(mapPath, JSON.stringify({ ...existing, ...entries }, null, 2), "utf-8");
}

function makeConfig(tempDir: string, isolation = false): SessionContextConfig {
  return { sessionsDir: tempDir, isolation, defaultLimit: 20, maxLimit: 100 };
}

describe("search-session", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-context-search-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("searches current channel by default", async () => {
    const currentKey = await writeChannelFixture(tempDir, "onebot", "10001", {
      platform: "onebot",
      channel: "10001",
      current_session: "current.jsonl",
    });
    await writeJsonl(tempDir, `${currentKey}/current.jsonl`, [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:00.000Z",
        content: "remember oauth callback",
        details: { senderId: "alice" },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig(tempDir), {
      platform: "onebot",
      channelId: "10001",
      channelKey: currentKey,
    });
    const result = await tool.execute({ query: "oauth" });

    expect(result).toMatchObject({ scope: "current", totalMatches: 1 });
    expect(
      (result as { results: Array<{ channelKey: string; sessionId: string }> }).results[0],
    ).toMatchObject({
      channelKey: currentKey,
      sessionId: "current",
    });
  });

  it("supports global search with narrowing filters", async () => {
    const currentKey = await writeChannelFixture(tempDir, "onebot", "10001", {
      platform: "onebot",
      channel: "10001",
      current_session: "current.jsonl",
    });
    const otherKey = await writeChannelFixture(tempDir, "discord", "guild-2", {
      platform: "discord",
      channel: "guild-2",
      current_session: "chat.jsonl",
    });
    await mergeChannelMap(tempDir, {
      [currentKey]: { platform: "onebot", channel: "10001" },
      [otherKey]: { platform: "discord", channel: "guild-2" },
    });
    await writeJsonl(tempDir, `${currentKey}/current.jsonl`, []);
    await writeJsonl(tempDir, `${otherKey}/chat.jsonl`, [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T13:00:00.000Z",
        content: "oauth callback broken",
        details: { senderId: "bob" },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig(tempDir), null);
    const result = await tool.execute({ scope: "global", query: "oauth", channelLimit: 5 });

    expect(result).toMatchObject({ scope: "global", channelsSearched: 2, totalMatches: 1 });
    expect(
      (result as { results: Array<{ platform: string; channelId: string }> }).results[0],
    ).toMatchObject({
      platform: "discord",
      channelId: "guild-2",
    });
  });

  it("rejects global search without narrowing filters", async () => {
    const tool = createSearchSessionTool(makeConfig(tempDir), null);
    const result = await tool.execute({ scope: "global" });
    expect(result).toMatchObject({ code: "QUERY_TOO_BROAD" });
  });

  it("maps legacy keyword and user inputs to new search fields", async () => {
    const channelKey = await writeChannelFixture(tempDir, "onebot", "10001", {
      platform: "onebot",
      channel: "10001",
      current_session: "current.jsonl",
    });
    await writeJsonl(tempDir, `${channelKey}/current.jsonl`, [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:00.000Z",
        content: "alice likes kanban",
        details: { senderId: "alice" },
      },
    ]);

    const tool = createSearchSessionTool(makeConfig(tempDir), null);
    const result = await tool.execute({
      platform: "onebot",
      channelId: "10001",
      keyword: "kanban",
      user: "alice",
    });
    expect(result).toMatchObject({ totalMatches: 1 });
  });
});
