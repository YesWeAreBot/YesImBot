import { SessionManager } from "@yesimbot/agent/session";
import { describe, expect, it } from "vitest";

import {
  buildAgentSessionConfig,
  persistDeliveryEvents,
} from "../../src/internal/runtime/helpers.js";
import type { RuntimeSettings } from "../../src/internal/runtime/settings.js";

const SETTINGS: RuntimeSettings = {
  contextWindow: 128000,
  compaction: {
    enabled: true,
    reserveTokens: 1000,
    keepRecentTokens: 2000,
    prompts: {
      systemPrompt: "custom-system",
      summarizationPrompt: "custom-summary",
    },
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  },
  steeringMode: "all",
  followUpMode: "all",
  delivery: {
    enabled: true,
    segmentation: {
      sepToken: "<sep/>",
      targetCountWeights: { one: 1, two: 0, three: 0 },
      shortSegmentChars: 6,
      shortTextChars: 25,
    },
    timing: {
      initialDelayMinMs: 0,
      initialDelayMaxMs: 0,
      followupDelayMinMs: 0,
      followupDelayMaxMs: 0,
      maxDelayMs: 0,
      minimumBufferMinMs: 0,
      minimumBufferMaxMs: 0,
    },
  },
};

describe("runtime session helpers", () => {
  it("forwards configured compaction prompts to AgentSession config", () => {
    const config = buildAgentSessionConfig(SETTINGS);

    expect(config.compactionSettings).toBe(SETTINGS.compaction);
    expect(config.compactionPrompts).toBe(SETTINGS.compaction.prompts);
  });

  it("persists delivery events as non-LLM custom entries", () => {
    const sessionManager = SessionManager.inMemory("/tmp/test");
    const error = new Error("send failed");

    persistDeliveryEvents(sessionManager, [
      {
        version: 1,
        kind: "failed",
        timestamp: 1000,
        source: "delivery",
        reason: "submit failed",
        generatedContent: "原始内容",
        attemptedSegments: ["原始内容"],
        failedSegments: ["原始内容"],
        error,
      },
    ]);

    const entries = sessionManager.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "custom",
      customType: "athena:delivery_event",
      data: {
        display: false,
        details: {
          kind: "failed",
          reason: "submit failed",
          generatedContent: "原始内容",
          error: {
            name: "Error",
            message: "send failed",
          },
        },
      },
    });
  });
});
