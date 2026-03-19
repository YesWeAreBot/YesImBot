import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Config as CoreConfig } from "../src/index";

vi.mock("koishi", async () => {
  const schemaModule = await vi.importActual<typeof import("schemastery")>("schemastery");
  const BaseSchema = (schemaModule as unknown as { default?: unknown }).default ?? schemaModule;
  const Schema = {
    ...(BaseSchema as Record<string, unknown>),
    dynamic: () => (BaseSchema as { string: () => unknown }).string(),
    path: () => (BaseSchema as { string: () => unknown }).string(),
  };

  return {
    Schema,
    Context: class {},
    Service: class {},
    Random: { id: () => "mock-id" },
    h: {
      parse: () => [],
    },
  };
});

vi.mock("../src/services/agent", () => ({
  AgentCore: class {},
}));

vi.mock("../src/services/agent/willingness", async () => {
  const schemaModule = await vi.importActual<typeof import("schemastery")>("schemastery");
  const BaseSchema = (schemaModule as unknown as { default?: unknown }).default ?? schemaModule;

  return {
    WillingnessSchema: (
      BaseSchema as { object: (dict: Record<string, unknown>) => unknown }
    ).object({}),
  };
});

vi.mock("../src/services/arousal", () => ({
  ArousalService: class {},
}));

vi.mock("../src/services/formatter", () => ({
  FormatterService: class {},
}));

vi.mock("../src/services/hook/service", () => ({
  HookService: class {},
}));

vi.mock("../src/services/horizon", () => ({
  HorizonService: class {},
}));

vi.mock("../src/services/image-cache/service", () => ({
  ImageCacheService: class {},
}));

vi.mock("../src/services/memory-agent", () => ({
  MemoryAgentService: class {},
}));

vi.mock("../src/services/model", () => ({
  ModelService: class {},
}));

vi.mock("../src/services/plugin/service", () => ({
  PluginService: class {},
}));

vi.mock("../src/services/prompt", () => ({
  PromptService: class {},
}));

vi.mock("../src/services/role", () => ({
  PersonaService: class {},
}));

vi.mock("../src/services/skill", () => ({
  AgentSessionStore: class {},
  SkillRegistry: class {},
}));

import { Config } from "../src/index";

export function createValidConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  const base = {
    model: "openai:gpt-4o-mini",
    summaryModel: "openai:gpt-4o-mini",
    fallbackChain: [],
    errorReportChannel: "",
    allowedChannels: [],
    keywords: [],
    compressionThreshold: 100,
    inactivityTriggerMs: 3600000,
    retainRecentEntries: 10,
    maxRounds: 3,
    streamMode: false,
    globalTimeout: 120000,
    maxToolResultLength: 4000,
    concurrency: 5,
    willingness: {
      maxWillingness: 100,
      mentionBoost: 0.8,
      decay: {
        halfLife: 300,
        elasticThreshold: 0.7,
      },
      gain: {
        baseGain: 15,
        keywordMultiplier: 1.5,
        keywords: [],
      },
      sigmoid: {
        midpoint: 0.5,
        steepness: 10,
      },
      fatigue: {
        windowMs: 120000,
        threshold: 3,
        penaltyBase: 0.5,
      },
      deferred: {
        threshold: 0.3,
        minDelayMs: 3000,
        maxDelayMs: 15000,
        model: "openai:gpt-4o-mini",
        fallbackChain: [],
      },
      dm: {
        directBoost: 0.95,
        aggregationMinMs: 3000,
        aggregationMaxMs: 8000,
        aggregationCapMs: 15000,
      },
      rateLimit: {
        dm: {
          capacity: 5,
          refillRate: 0.5,
        },
        group: {
          capacity: 10,
          refillRate: 1,
        },
      },
    },
    aggregationWindow: 2000,
    templates: {},
    timeout: 5000,
    rolePath: "data/yesimbot/roles",
    skillPaths: ["node_modules/koishi-plugin-yesimbot/resources/skills"],
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
    hookTimeouts: {
      tool: 3000,
      agent: 5000,
    },
    memoryAgent: {
      coreMemoryBudget: 2000,
      summaryModel: "openai:gpt-4o-mini",
      maxAgentSteps: 15,
    },
    arousal: {
      enabled: false,
      heartbeatIntervalMs: 1800000,
      excludeChannels: [],
      dailyMessageLimit: 3,
      evaluationModel: "openai:gpt-4o-mini",
    },
  } as CoreConfig & { timeout: number };

  return {
    ...base,
    ...overrides,
  } as CoreConfig;
}

describe("Config schema validation", () => {
  it("accepts the full default-like core config", () => {
    const validated = Config(createValidConfig());

    expect(validated.compressionThreshold).toBe(100);
    expect(validated.inactivityTriggerMs).toBe(3600000);
    expect(validated.retainRecentEntries).toBe(10);
    expect(validated.imageMode).toBe("native");
    expect(validated.charBudget).toBe(30000);
    expect(validated.hookTimeouts).toBeDefined();
    expect(validated.hookTimeouts?.tool).toBe(3000);
    expect(validated.arousal.heartbeatIntervalMs).toBe(1800000);
  });

  it("accepts representative pre-hardening values at the new numeric boundaries", () => {
    const validated = Config(
      createValidConfig({
        compressionThreshold: 1,
        inactivityTriggerMs: 1000,
        retainRecentEntries: 1,
        imageMode: "off",
        charBudget: 1000,
        hookTimeouts: {
          tool: 1000,
          agent: 1000,
        },
        arousal: {
          enabled: false,
          heartbeatIntervalMs: 1000,
          excludeChannels: [],
          dailyMessageLimit: 1,
          evaluationModel: "openai:gpt-4o-mini",
        },
      }),
    );

    expect(validated.compressionThreshold).toBe(1);
    expect(validated.inactivityTriggerMs).toBe(1000);
    expect(validated.retainRecentEntries).toBe(1);
    expect(validated.imageMode).toBe("off");
    expect(validated.charBudget).toBe(1000);
    expect(validated.hookTimeouts).toBeDefined();
    expect(validated.hookTimeouts?.tool).toBe(1000);
    expect(validated.arousal.heartbeatIntervalMs).toBe(1000);
  });

  it("keeps root compression fields separate from memoryAgent summary settings", () => {
    const validated = Config(
      createValidConfig({
        summaryModel: "openai:gpt-4o-mini",
        compressionThreshold: 222,
        inactivityTriggerMs: 4440000,
        retainRecentEntries: 12,
        memoryAgent: {
          coreMemoryBudget: 4096,
          summaryModel: "openai:gpt-4o",
          maxAgentSteps: 30,
        },
      }),
    );

    expect(validated.compressionThreshold).toBe(222);
    expect(validated.inactivityTriggerMs).toBe(4440000);
    expect(validated.retainRecentEntries).toBe(12);
    expect(validated.memoryAgent.summaryModel).toBe("openai:gpt-4o");
    expect(validated.summaryModel).toBe("openai:gpt-4o-mini");
  });

  it("locks the schema group marker order in source", () => {
    const source = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");

    const expectedOrder = [
      "// ── 基础 ──",
      "// ── 模型 ──",
      "// ── 意愿值 ──",
      "// ── 提示词 ──",
      "// ── 图片 ──",
      "// ── 记忆代理 ──",
      "// ── 主动唤醒 ──",
      "// ── 上下文管理 ──",
      "// ── 高级 ──",
    ];

    const positions = expectedOrder.map((marker) => source.indexOf(marker));
    positions.forEach((position) => expect(position).toBeGreaterThan(-1));

    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("declares min max step chains for key numeric fields", () => {
    const source = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");

    expect(source).toMatch(
      /globalTimeout:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
    expect(source).toMatch(
      /charBudget:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
    expect(source).toMatch(
      /archiveThresholdMs:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
    expect(source).toMatch(
      /maxImagesInContext:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
    expect(source).toMatch(
      /tool:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
    expect(source).toMatch(
      /coreMemoryBudget:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
    expect(source).toMatch(
      /heartbeatIntervalMs:\s*Schema\.number\(\)\s*\.min\([^)]*\)\s*\.max\([^)]*\)\s*\.step\([^)]*\)/,
    );
  });
});
