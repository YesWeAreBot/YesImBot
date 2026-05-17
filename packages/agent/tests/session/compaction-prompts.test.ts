import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import { Agent } from "../../src/agent/agent.js";
import { AgentSession } from "../../src/session/agent-session.js";
import {
  type CompactionPrompts,
  DEFAULT_COMPACTION_PROMPTS,
} from "../../src/session/compaction/index.js";
import { convertToLlm } from "../../src/session/messages.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySettingsStorage, SettingsManager } from "../../src/session/settings-manager.js";

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
        start(controller) {
          controller.close();
        },
      }),
    }),
  } as LanguageModel;
}

function createSession(options?: {
  settingsPrompts?: CompactionPrompts;
  configPrompts?: CompactionPrompts;
}): AgentSession {
  const storage = new InMemorySettingsStorage();
  const settingsPath = "/tmp/test/settings.json";
  if (options?.settingsPrompts) {
    storage.save(settingsPath, {
      compaction: {
        prompts: options.settingsPrompts,
      },
    });
  }
  const settingsManager = new SettingsManager({
    globalPath: settingsPath,
    storage,
  });
  const agent = new Agent({
    model: createMockModel(),
    convertToLlm: (messages) => convertToLlm(messages),
  });

  return new AgentSession({
    cwd: "/tmp/test",
    agent,
    sessionManager: SessionManager.inMemory("/tmp/test"),
    settingsManager,
    compactionPrompts: options?.configPrompts,
  });
}

describe("compaction prompts configuration", () => {
  it("uses chat-oriented default prompts", () => {
    expect(DEFAULT_COMPACTION_PROMPTS.systemPrompt).toContain("context summarization assistant");
    expect(DEFAULT_COMPACTION_PROMPTS.summarizationPrompt).toContain(
      "## User Profile & Preferences",
    );
    expect(DEFAULT_COMPACTION_PROMPTS.summarizationPrompt.toLowerCase()).not.toContain(
      "coding agent",
    );
  });

  it("merges compaction prompts with priority config > settings > defaults", () => {
    const session = createSession({
      settingsPrompts: {
        systemPrompt: "settings-system",
        summarizationPrompt: "settings-summary",
      },
      configPrompts: {
        summarizationPrompt: "config-summary",
        turnPrefixPrompt: "config-turn-prefix",
      },
    }) as unknown as { _compactionPrompts: Required<CompactionPrompts> };

    expect(session._compactionPrompts.systemPrompt).toBe("settings-system");
    expect(session._compactionPrompts.summarizationPrompt).toBe("config-summary");
    expect(session._compactionPrompts.turnPrefixPrompt).toBe("config-turn-prefix");
    expect(session._compactionPrompts.updateSummarizationPrompt).toBe(
      DEFAULT_COMPACTION_PROMPTS.updateSummarizationPrompt,
    );
  });
});
