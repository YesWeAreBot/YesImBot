import { describe, expect, it, vi } from "vitest";

import { apply } from "../src/index";
import { AgentCore } from "../src/services/agent";
import { HookService } from "../src/services/hook/service";
import { PluginService } from "../src/services/plugin";

function createConfig(): Record<string, unknown> {
  return {
    model: "mock:model",
    summaryModel: "mock:summary",
    fallbackChain: [],
    errorReportChannel: "test-channel",
    allowedChannels: [],
    keywords: [],
    maxRounds: 3,
    streamMode: false,
    globalTimeout: 120000,
    maxToolResultLength: 4000,
    concurrency: 1,
    willingness: {
      initial: 0.5,
      decayPerSecond: 0.01,
      triggerGain: 0.1,
      triggerKeywordMultiplier: 1.5,
      mentionGain: 0.2,
      quoteGain: 0.15,
      directMessageGain: 0.2,
      directMessageThreshold: 0.8,
      floor: 0,
      ceiling: 1,
      randomThreshold: 0.3,
      llmJudgmentThreshold: 0.7,
      llmCooldownMs: 30000,
      sigmoidSteepness: 4,
      sigmoidCenter: 0.5,
      fatiguePenalty: 0.05,
      fatigueWindowMs: 60000,
      stressPenalty: 0.1,
      stressWindowMs: 60000,
      stressRecoveryPerSecond: 0.01,
      stressThreshold: 1,
      maxTokenBucket: 10,
      tokenRecoveryPerSecond: 1,
      bucketThreshold: 1,
    },
    aggregationWindow: 1500,
    templates: {},
    timeout: 5000,
    rolePath: "data/yesimbot/roles",
    skillPaths: [],
    confidenceThreshold: 0.3,
    stickyDefaultTimeout: 3,
    enableThoughts: true,
    charBudget: 30000,
    keepLastRounds: 2,
    softTrimHead: 800,
    softTrimTail: 800,
    initialContextCharBudget: 20000,
    historyLimit: 30,
    archiveThresholdMs: 86400000,
    entityCacheTtl: 3600000,
    maxActiveEntities: 15,
    defaultTimeout: 30000,
    debugLevel: 2,
    imageMode: "native",
    maxImagesInContext: 3,
    imageLifecycleCount: 3,
    memoryAgent: {
      compressionThreshold: 80,
      compressionIntervalMs: 3600000,
      inactivityTriggerMs: 1800000,
      coreMemoryBudget: 2000,
      summaryModel: "mock:summary",
      maxAgentSteps: 15,
      retainRecentEntries: 10,
    },
    arousal: {
      enabled: false,
      heartbeatIntervalMs: 1800000,
      excludeChannels: [],
      dailyMessageLimit: 3,
      evaluationModel: "mock:model",
    },
  };
}

describe("Hook runtime startup registration", () => {
  it("registers HookService in apply() before PluginService and AgentCore", () => {
    const pluginCalls: Array<{ plugin: unknown; options?: unknown }> = [];
    const ctx = {
      logger: vi.fn(() => ({ info: vi.fn() })),
      command: vi.fn(() => ({
        subcommand: vi.fn(() => ({ action: vi.fn() })),
      })),
      plugin: vi.fn((plugin: unknown, options?: unknown) => {
        pluginCalls.push({ plugin, options });
      }),
      on: vi.fn(),
      scope: { update: vi.fn() },
    };

    apply(ctx as never, createConfig() as never);

    const hookIndex = pluginCalls.findIndex((entry) => entry.plugin === HookService);
    const pluginIndex = pluginCalls.findIndex((entry) => entry.plugin === PluginService);
    const agentIndex = pluginCalls.findIndex((entry) => entry.plugin === AgentCore);

    expect(hookIndex).toBeGreaterThanOrEqual(0);
    expect(pluginIndex).toBeGreaterThanOrEqual(0);
    expect(agentIndex).toBeGreaterThanOrEqual(0);
    expect(hookIndex).toBeLessThan(pluginIndex);
    expect(hookIndex).toBeLessThan(agentIndex);
    expect(pluginCalls[hookIndex]?.plugin).toBe(HookService);
  });

  it("keeps the yesimbot.hook service key contract in HookService constructor", () => {
    expect(HookService.name).toBe("HookService");
    expect(HookService.toString()).toMatch(/yesimbot\.hook/);
  });
});
