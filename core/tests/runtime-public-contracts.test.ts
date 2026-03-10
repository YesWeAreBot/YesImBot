import { describe, expect, it, vi } from "vitest";

import { ThinkActLoop } from "../src/services/agent/loop";
import { HookPhase, HookType } from "../src/services/hook/types";
import type { HookExecutionContext } from "../src/services/hook/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";
import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  createRoundContext,
} from "../src/services/runtime/adapters";
import type { Capabilities, RoundContext, Scenario } from "../src/services/runtime/contracts";

describe("runtime public contracts", () => {
  it("tool and hook context contracts", () => {
    const scenario = {} as Scenario;
    const capabilities = {} as Capabilities;
    const roundContext = {} as RoundContext;

    const toolCtx: ToolExecutionContext = {
      platform: "discord",
      channelId: "c1",
      scenario,
      capabilities,
      roundContext,
    };

    const hookCtx: HookExecutionContext = {
      ...toolCtx,
      hookType: HookType.Tool,
      hookPhase: HookPhase.Before,
    };

    expect(toolCtx.platform).toBe("discord");
    expect(hookCtx.hookType).toBe(HookType.Tool);
  });

  it("prompt scope exposes scenario", async () => {
    const promptRenderSpy = vi.fn().mockResolvedValue([
      { name: "soul", content: "soul", cacheable: true },
      { name: "instructions", content: "instructions", cacheable: true },
      { name: "extra", content: "extra", cacheable: true },
    ]);

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
      "yesimbot.plugin": {
        getTools: vi.fn(() => []),
        getDefinition: vi.fn(),
        invoke: vi.fn(),
      },
      "yesimbot.prompt": {
        render: promptRenderSpy,
        inject: vi.fn(() => () => undefined),
      },
      "yesimbot.model": {
        getProvider: vi.fn(() => ({ providerType: "openai" })),
        call: vi.fn().mockResolvedValue({ text: JSON.stringify({ actions: [] }), usage: {} }),
      },
      "yesimbot.trait": {
        analyze: vi.fn().mockResolvedValue([]),
      },
      "yesimbot.skill": {
        resolve: vi.fn().mockReturnValue({
          activeSkills: [],
          promptInjections: [],
          toolFilter: undefined,
          styleOverride: undefined,
        }),
      },
      "yesimbot.arousal": undefined,
    } as unknown as ConstructorParameters<typeof ThinkActLoop>[0];

    const percept = {
      id: "wake-1",
      traceId: "trace-1",
      type: "mention",
      platform: "discord",
      channelId: "c1",
      timestamp: new Date("2026-03-10T00:00:00Z"),
      metadata: { messageId: "m1", senderId: "u1" },
    };

    const roundContext = createRoundContext({
      percept: percept as never,
      scenario: {
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
          timeline: [],
          stimulusSource: { type: "message", messageId: "m1", senderId: "u1" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: buildCapabilitiesFromRuntime({
        session: undefined,
        bot: undefined,
      }),
    });

    const toolCtx = bindCommittedRoundContext(
      {
        platform: "discord",
        channelId: "c1",
        view: {
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
        },
        traits: [],
        skills: [],
      },
      roundContext,
    ) as unknown as ToolExecutionContext;

    const loop = new ThinkActLoop(ctx, {
      model: "openai:gpt",
      fallbackChain: [],
      maxRounds: 1,
    });

    await loop.run(percept as never, toolCtx as never);

    expect(promptRenderSpy).toHaveBeenCalledWith(
      "system",
      expect.objectContaining({
        percept: expect.any(Object),
        roundContext: expect.any(Object),
        scenario: expect.any(Object),
      }),
    );
  });
});
