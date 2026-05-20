import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import { Agent } from "../../src/agent/agent.js";
import { AgentSession } from "../../src/session/agent-session.js";
import { convertToLlm } from "../../src/session/messages.js";
import { SessionManager } from "../../src/session/session-manager.js";

function createMockModel(): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    supportedUrls: {},
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0 },
      content: [],
      response: { id: "test", timestamp: new Date(), modelId: "test" },
      providerMetadata: undefined,
      request: { body: "{}" },
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
    }),
  } as LanguageModel;
}

function createTestSession(config?: {
  contextWindow?: number;
  compactionSettings?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number };
  retrySettings?: {
    enabled?: boolean;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
}) {
  const agent = new Agent({
    model: createMockModel(),
    convertToLlm: (messages) => convertToLlm(messages),
  });
  return new AgentSession({
    cwd: "/tmp/test",
    agent,
    sessionManager: SessionManager.inMemory("/tmp/test"),
    ...config,
  });
}

describe("AgentSession settings contract", () => {
  it("accepts plain runtime config with defaults", () => {
    const session = createTestSession();

    expect(session.autoCompactionEnabled).toBe(true);
    expect(session.steeringMode).toBe("all");
    expect(session.followUpMode).toBe("all");
  });

  it("accepts custom context window", () => {
    const session = createTestSession({ contextWindow: 64000 });

    // Context window is internal; we verify via getContextUsage which uses it
    const usage = session.getContextUsage();
    // No messages yet, so tokens should be 0 or null
    expect(usage?.contextWindow).toBe(64000);
  });

  it("accepts custom compaction settings", () => {
    const session = createTestSession({
      compactionSettings: { enabled: false, reserveTokens: 8192 },
    });

    expect(session.autoCompactionEnabled).toBe(false);
  });

  it("accepts custom steering and follow-up modes", () => {
    const session = createTestSession({
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });

    expect(session.steeringMode).toBe("one-at-a-time");
    expect(session.followUpMode).toBe("one-at-a-time");
  });

  it("setters update memory state without persistence", () => {
    const session = createTestSession();

    session.setContextWindow(64000);
    session.setCompactionReserveTokens(8192);
    session.setCompactionKeepRecentTokens(10000);
    session.setRetryMaxRetries(5);
    session.setRetryBaseDelayMs(1000);
    session.setRetryMaxDelayMs(30000);
    session.setSteeringMode("one-at-a-time");
    session.setFollowUpMode("one-at-a-time");
    session.setAutoCompactionEnabled(false);
    session.setAutoRetryEnabled(false);

    // Verify all setters took effect in memory
    const usage = session.getContextUsage();
    expect(usage?.contextWindow).toBe(64000);
    expect(session.steeringMode).toBe("one-at-a-time");
    expect(session.followUpMode).toBe("one-at-a-time");
    expect(session.autoCompactionEnabled).toBe(false);
    expect(session.autoRetryEnabled).toBe(false);
  });

  it("does not have a settings getter", () => {
    const session = createTestSession();

    // settings getter should be removed
    expect((session as any).settings).toBeUndefined();
  });
});
