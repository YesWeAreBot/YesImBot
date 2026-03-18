import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  function createSchemaChain() {
    const chain: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, prop) => {
        if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
        return (..._args: unknown[]) => new Proxy(chain, handler);
      },
    };
    return new Proxy(chain, handler);
  }

  const SchemaMock = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "intersect" || prop === "object" || prop === "array") {
          return (..._args: unknown[]) => createSchemaChain();
        }
        if (prop === "number" || prop === "string" || prop === "boolean") {
          return () => createSchemaChain();
        }
        if (prop === "dynamic") {
          return () => createSchemaChain();
        }
        return (..._args: unknown[]) => createSchemaChain();
      },
    },
  );

  class Service {
    ctx: Record<string, unknown>;
    config: unknown;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>, _name: string, _immediate?: boolean) {
      this.ctx = ctx;
      this.config = {};
      this.logger = (ctx.logger as (name: string) => Record<string, unknown>)("mock-service");
    }
  }

  return {
    Schema: SchemaMock,
    Context: class {},
    Service,
    Random: { id: () => "mock-random-id" },
    h: vi.fn(),
  };
});

import { Context } from "koishi";

import { apply, type Config } from "../src/index";
import { SummaryCompressor } from "../src/services/horizon/compressor";
import { HorizonService } from "../src/services/horizon/service";
import { MemoryAgentService } from "../src/services/memory-agent";

vi.mock("../src/services/horizon/compressor", () => {
  const SummaryCompressorMock = vi.fn(function SummaryCompressorMock() {
    return {
      maybeCompress: vi.fn(),
    };
  });
  return {
    SummaryCompressor: SummaryCompressorMock,
  };
});

function createBaseConfig(overrides: Partial<Config> = {}): Config {
  return {
    model: "openai:gpt-4o-mini",
    summaryModel: "openai:gpt-4o-mini",
    fallbackChain: [],
    errorReportChannel: "",
    allowedChannels: [],
    keywords: [],
    compressionThreshold: 111,
    inactivityTriggerMs: 2_222_000,
    retainRecentEntries: 9,
    maxRounds: 2,
    streamMode: false,
    globalTimeout: 120000,
    maxToolResultLength: 4000,
    concurrency: 1,
    willingness: {
      defaultWillingness: 0.1,
      decayRate: 0.05,
      maxWillingness: 1,
      minWillingness: 0,
      mentionWeight: 1,
      keywordWeight: 0.5,
      directMessageWeight: 1,
      fatigueFactor: 0.9,
      decisionThreshold: 0.4,
      llmDecisionThreshold: 0.7,
      tokenBucketCapacity: 5,
      tokenBucketRefillRate: 1,
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
    debugLevel: 0,
    imageMode: "native",
    maxImagesInContext: 3,
    imageLifecycleCount: 3,
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
    ...overrides,
  };
}

describe("Hybrid compression trigger config wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires root trigger fields through apply() into HorizonService options", () => {
    const ctx = {
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
      command: vi.fn(() => ({
        subcommand: vi.fn(() => ({ action: vi.fn() })),
      })),
      plugin: vi.fn(),
      on: vi.fn(),
      scope: { update: vi.fn() },
    } as unknown as Context;

    apply(ctx, createBaseConfig());

    const horizonCall = (ctx.plugin as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === HorizonService,
    );
    expect(horizonCall).toBeDefined();
    expect(horizonCall?.[1]).toMatchObject({
      summaryModel: "openai:gpt-4o-mini",
      compressionThreshold: 111,
      inactivityTriggerMs: 2_222_000,
      retainRecentEntries: 9,
    });
  });

  it("keeps trigger ownership outside memoryAgent when apply() receives mixed config", () => {
    const ctx = {
      logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
      command: vi.fn(() => ({
        subcommand: vi.fn(() => ({ action: vi.fn() })),
      })),
      plugin: vi.fn(),
      on: vi.fn(),
      scope: { update: vi.fn() },
    } as unknown as Context;

    const config = createBaseConfig({
      compressionThreshold: 222,
      inactivityTriggerMs: 3_333_000,
      retainRecentEntries: 12,
      memoryAgent: {
        coreMemoryBudget: 4096,
        summaryModel: "openai:gpt-4o",
        maxAgentSteps: 30,
      },
    });

    apply(ctx, config);

    const horizonCall = (ctx.plugin as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === HorizonService,
    );
    const memoryCall = (ctx.plugin as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === MemoryAgentService,
    );

    expect(horizonCall?.[1]).toMatchObject({
      compressionThreshold: 222,
      inactivityTriggerMs: 3_333_000,
      retainRecentEntries: 12,
    });
    expect(horizonCall?.[1]).not.toHaveProperty("memoryAgent.compressionThreshold");
    expect(memoryCall?.[1]).toEqual({
      memoryAgent: {
        coreMemoryBudget: 4096,
        summaryModel: "openai:gpt-4o",
        maxAgentSteps: 30,
      },
    });
  });

  it("forwards root trigger values to SummaryCompressor in HorizonService constructor", () => {
    const loggerFactory = Object.assign(
      vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })),
      { warn: vi.fn() },
    );
    const ctx = {
      logger: loggerFactory,
      model: { extend: vi.fn() },
      command: vi.fn(() => ({ subcommand: vi.fn() })),
      baseDir: "/tmp/test",
      on: vi.fn(),
      database: {},
      "yesimbot.prompt": {},
      "yesimbot.formatter": {},
      "yesimbot.image-cache": {},
    };

    new HorizonService(ctx as Context, {
      allowedChannels: [],
      summaryModel: "openai:gpt-4o-mini",
      compressionThreshold: 300,
      inactivityTriggerMs: 4_000_000,
      retainRecentEntries: 18,
    });

    expect(SummaryCompressor).toHaveBeenCalledWith(ctx, expect.anything(), "openai:gpt-4o-mini", {
      compressionThreshold: 300,
      inactivityTriggerMs: 4_000_000,
      retainRecentEntries: 18,
    });
  });
});
