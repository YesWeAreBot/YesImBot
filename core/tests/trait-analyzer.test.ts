import { describe, expect, it, vi } from "vitest";

import { ThinkActLoop } from "../src/services/agent/loop";
import {
  DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  type Percept,
  type RoundContext,
  type Scenario,
} from "../src/services/runtime/contracts";
import { TraitAnalyzer } from "../src/services/trait/service";

function createPercept(): Percept {
  return {
    id: "wake-trait-1",
    traceId: "trace-trait-1",
    type: "mention",
    platform: "discord",
    channelId: "c1",
    timestamp: new Date("2026-03-14T00:00:00Z"),
    metadata: { messageId: "m1", senderId: "u1" },
  };
}

describe("trait analyzer optional posture", () => {
  it("TraitAnalyzer is optional — agent loop does not require it", async () => {
    const ctx = {
      baseDir: "/tmp",
      logger: vi.fn(() => ({
        level: 2,
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
      "yesimbot.horizon": {
        buildView: vi.fn().mockResolvedValue({
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          history: [],
        }),
        formatHorizonText: vi.fn().mockResolvedValue([]),
        events: {
          recordAgentResponse: vi.fn(),
          recordAgentAction: vi.fn(),
          recordMessage: vi.fn(),
          markAsActive: vi.fn(),
          archiveStale: vi.fn(),
        },
        compressor: undefined,
        config: { archiveThresholdMs: 86400000 },
      },
      "yesimbot.plugin": { getTools: vi.fn(() => []), getDefinition: vi.fn(), invoke: vi.fn() },
      "yesimbot.prompt": {
        emitPromptBlocks: vi.fn().mockResolvedValue({
          sections: [],
          stableBlock: "",
          dynamicBlock: "",
          stableSignature: "sig",
        }),
        registerFragmentSource: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.skill": { get: vi.fn() },
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const loop = new ThinkActLoop(ctx, { model: "openai:gpt", fallbackChain: [], maxRounds: 1 });
    await expect(
      loop.run(createPercept(), { platform: "discord", channelId: "c1" } as never),
    ).resolves.toEqual({ totalTokens: 0, totalToolCalls: 0 });
  });

  it("TraitAnalyzer.analyze() is callable as a standalone detector", async () => {
    const detector = {
      detect: vi
        .fn()
        .mockResolvedValue([
          { dimension: "scene", value: "group-chat", confidence: 1, metadata: { source: "test" } },
        ]),
    };
    const logger = { warn: vi.fn() };
    const analyzerLike = {
      detectors: [detector],
      logger,
    };

    const scenario: Scenario = {
      raw: {
        self: { id: "bot", name: "Athena" },
        environment: {
          type: "group",
          id: "c1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [],
        timeline: {
          turns: [],
          activeSegment: { mode: "after-latest-summary" },
          markedEvents: [],
          heartbeatEvents: [],
          semantics: DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
        },
        scenarioTimeline: {
          turns: [],
          activeSegment: { mode: "after-latest-summary" },
          markedEvents: [],
          heartbeatEvents: [],
          semantics: DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
        },
        stimulusSource: { type: "message" },
      },
      derived: { focus: {}, participants: [], attention: {}, recentMetrics: {} },
    };

    const result = await TraitAnalyzer.prototype.analyze.call(
      analyzerLike,
      { platform: "discord", channelId: "c1" },
      scenario,
    );
    expect(result).toEqual([
      expect.objectContaining({ dimension: "scene", value: "group-chat", confidence: 1 }),
    ]);
  });

  it("Hook can use TraitAnalyzer as optional detector to decide loadSkill", async () => {
    const loadSkill = vi.fn(async () => ({ status: "loaded" }));
    const roundContext = {
      percept: createPercept(),
      scenario: { raw: {}, derived: {} },
      capabilities: { core: {}, extended: {} },
      metadata: {},
      skillState: { active: [] },
      snapshot: {
        version: 1,
        createdAt: new Date(),
        scenario: { raw: {}, derived: {} },
        capabilities: { core: {}, extended: {} },
        metadata: {},
      },
    } as unknown as RoundContext;

    const hook = async (hookCtx: {
      runtimeCtx: Record<string, unknown>;
      roundContext: RoundContext;
      loadSkill(name: string): Promise<unknown>;
    }) => {
      const detector = hookCtx.runtimeCtx["yesimbot.trait"] as
        | {
            analyze: (
              key: { platform: string; channelId: string },
              scenario: unknown,
            ) => Promise<Array<{ dimension: string; value: string }>>;
          }
        | undefined;
      if (!detector) return;
      const signals = await detector.analyze(
        {
          platform: hookCtx.roundContext.percept.platform,
          channelId: hookCtx.roundContext.percept.channelId,
        },
        hookCtx.roundContext.scenario,
      );
      if (signals.some((signal) => signal.dimension === "scene" && signal.value === "group-chat")) {
        await hookCtx.loadSkill("group-chat-skill");
      }
    };

    await hook({
      runtimeCtx: {
        "yesimbot.trait": {
          analyze: vi.fn(async () => [{ dimension: "scene", value: "group-chat" }]),
        },
      },
      roundContext,
      loadSkill,
    });
    expect(loadSkill).toHaveBeenCalledWith("group-chat-skill");

    loadSkill.mockClear();
    await hook({ runtimeCtx: {}, roundContext, loadSkill });
    expect(loadSkill).not.toHaveBeenCalled();
  });
});
