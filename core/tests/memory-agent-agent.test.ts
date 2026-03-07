import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn((steps: number) => `step-limit:${steps}`),
}));

vi.mock("../src/services/memory-agent/tools", () => ({
  createMemoryTools: vi.fn(),
}));

import { generateText, stepCountIs } from "ai";

import { runMemoryExtraction } from "../src/services/memory-agent/agent";
import { TimelineEventType } from "../src/services/horizon/types";
import { createMemoryTools } from "../src/services/memory-agent/tools";
import type { MemoryAgentConfig } from "../src/services/memory-agent/types";

function createConfig(overrides: Partial<MemoryAgentConfig> = {}): MemoryAgentConfig {
  return {
    compressionThreshold: 80,
    compressionIntervalMs: 3600000,
    inactivityTriggerMs: 1800000,
    coreMemoryBudget: 1234,
    summaryModel: "openai:gpt-4o-mini",
    maxAgentSteps: 7,
    retainRecentEntries: 10,
    ...overrides,
  };
}

function createMockContext() {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  };

  const horizonQuery = vi.fn();
  const existingMemoryRows = [
    {
      id: "m1",
      type: "profile",
      scope: "user",
      scopeId: "user-1",
      content: "Alice likes tea",
      importance: 90,
      isCore: true,
    },
  ];

  const ctx: Record<string, unknown> = {
    logger: vi.fn(() => logger),
    "yesimbot.horizon": {
      events: {
        query: horizonQuery,
      },
    },
    "yesimbot.model": {
      getModel: vi.fn(() => ({
        model: { provider: "mock", id: "mock-language-model" },
      })),
    },
    database: {
      select: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue(existingMemoryRows),
      })),
    },
  };

  return { ctx, logger, horizonQuery };
}

describe("runMemoryExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds context and invokes ai-sdk generateText with tools", async () => {
    const { ctx, horizonQuery } = createMockContext();
    const tools = { queryMemories: { description: "query memories tool" } };
    vi.mocked(createMemoryTools).mockReturnValue(tools as never);
    vi.mocked(generateText).mockResolvedValue({
      steps: [{ toolCalls: [{ toolName: "queryMemories" }] }, { toolCalls: [] }],
    } as never);

    horizonQuery
      .mockResolvedValueOnce([
        {
          type: TimelineEventType.Message,
          timestamp: new Date("2026-03-07T12:00:00Z"),
          data: { senderId: "u1", senderName: "Alice", content: "hello there" },
        },
        {
          type: TimelineEventType.AgentResponse,
          timestamp: new Date("2026-03-07T12:01:00Z"),
          data: { rawText: "hi Alice" },
        },
      ])
      .mockResolvedValueOnce([
        {
          type: TimelineEventType.Summary,
          data: { content: "Older context summary." },
        },
      ]);

    const channelKey = { platform: "discord", channelId: "chan-1" };
    const config = createConfig();

    await runMemoryExtraction(ctx as never, channelKey, "discord", config);

    expect(createMemoryTools).toHaveBeenCalledWith(ctx, channelKey, "discord", config);
    expect(stepCountIs).toHaveBeenCalledWith(7);
    expect(generateText).toHaveBeenCalledTimes(1);

    const call = vi.mocked(generateText).mock.calls[0]?.[0];
    expect(call?.tools).toBe(tools);
    expect(call?.stopWhen).toBe("step-limit:7");
    expect(call?.system).toContain("memory management agent");
    expect(call?.system).toContain("1234");
    expect(call?.prompt).toContain("## Channel: discord:chan-1");
    expect(call?.prompt).toContain("Alice: hello there");
    expect(call?.prompt).toContain("[Bot]: hi Alice");
    expect(call?.prompt).toContain("## Previous Summary");
    expect(call?.prompt).toContain("Older context summary.");
    expect(call?.prompt).toContain("## Existing Memories");
    expect(call?.prompt).toContain("Alice likes tea");
  });

  it("skips extraction when there are no recent timeline entries", async () => {
    const { ctx, horizonQuery } = createMockContext();
    horizonQuery.mockResolvedValueOnce([]);

    await runMemoryExtraction(
      ctx as never,
      { platform: "discord", channelId: "empty-channel" },
      "discord",
      createConfig(),
    );

    expect(createMemoryTools).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("handles model/tool execution errors safely without throwing", async () => {
    const { ctx, logger, horizonQuery } = createMockContext();
    vi.mocked(createMemoryTools).mockReturnValue({ queryMemories: {} } as never);
    vi.mocked(generateText).mockRejectedValue(new Error("ai failed"));

    horizonQuery
      .mockResolvedValueOnce([
        {
          type: TimelineEventType.Message,
          timestamp: new Date("2026-03-07T12:00:00Z"),
          data: { senderId: "u1", senderName: "Alice", content: "hello there" },
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      runMemoryExtraction(
        ctx as never,
        { platform: "discord", channelId: "error-channel" },
        "discord",
        createConfig(),
      ),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
  });
});
