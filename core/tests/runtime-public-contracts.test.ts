import { describe, expect, it, vi } from "vitest";

import { ThinkActLoop } from "../src/services/agent/loop";
import { HookPhase, HookType } from "../src/services/hook/types";
import type {
  AgentEndHookExecutionContext,
  AgentStartHookExecutionContext,
  HookExecutionContext,
} from "../src/services/hook/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";
import { PROMPT_FRAGMENT_SOURCE_PRECEDENCE, PROMPT_SECTION_LAYOUT } from "../src/services/prompt";
import type {
  FragmentSource,
  PromptFragment,
  PromptLayout,
  PromptSectionName,
} from "../src/services/prompt";
import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  createRoundContext,
} from "../src/services/runtime/adapters";
import type { Capabilities, RoundContext, Scenario } from "../src/services/runtime/contracts";

describe("runtime public contracts", () => {
  it("prompt fragment-first contracts are publicly exported", () => {
    const layout: PromptLayout = PROMPT_SECTION_LAYOUT;
    const sectionName: PromptSectionName = "memory";
    const source: FragmentSource = "memory";
    const fragment: PromptFragment = {
      id: "memory-fragment",
      section: sectionName,
      source,
      priority: 100,
      stability: "stable",
      cacheable: true,
      content: "remember this",
    };

    expect(layout).toEqual(["identity", "policy", "memory", "situation"]);
    expect(fragment.section).toBe("memory");
    expect(fragment.source).toBe("memory");
  });

  it("source precedence stays explicit", () => {
    expect(PROMPT_FRAGMENT_SOURCE_PRECEDENCE).toEqual([
      "role",
      "memory",
      "scenario",
      "capability",
      "skill",
      "hook",
      "tooling",
    ]);
  });

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

  it("agent lifecycle contracts keep roundContext canonical at start and end", () => {
    const scenario = {} as Scenario;
    const capabilities = {} as Capabilities;
    const roundContext = {} as RoundContext;

    const startCtx: AgentStartHookExecutionContext = {
      platform: "discord",
      channelId: "c1",
      hookType: HookType.Agent,
      hookPhase: HookPhase.Before,
      lifecycle: "start",
      roundContext,
      scenario,
      capabilities,
    };

    const endCtx: AgentEndHookExecutionContext = {
      ...startCtx,
      hookPhase: HookPhase.After,
      lifecycle: "end",
      endSummary: {
        finalOutcome: {
          status: "success",
          producedVisibleOutput: true,
          actions: {
            total: 1,
            succeeded: 1,
            failed: 0,
            names: ["send_message"],
          },
          toolCalls: {
            total: 1,
            succeeded: 1,
            failed: 0,
            names: ["search_web"],
          },
        },
        incidents: [
          {
            phase: "tool",
            category: "tool-error",
            summary: "transient provider timeout",
            recovered: true,
          },
        ],
      },
    };

    expect(startCtx.roundContext).toBe(roundContext);
    expect(endCtx.endSummary.finalOutcome.status).toBe("success");
    expect(endCtx.endSummary.incidents[0]?.recovered).toBe(true);
  });

  it("agent end summary separates final outcome from incidents", () => {
    const endCtx: AgentEndHookExecutionContext = {
      platform: "discord",
      channelId: "c1",
      hookType: HookType.Agent,
      hookPhase: HookPhase.After,
      lifecycle: "end",
      roundContext: {} as RoundContext,
      scenario: {} as Scenario,
      capabilities: {} as Capabilities,
      endSummary: {
        finalOutcome: {
          status: "skipped",
          producedVisibleOutput: false,
          actions: {
            total: 0,
            succeeded: 0,
            failed: 0,
            names: [],
          },
          toolCalls: {
            total: 0,
            succeeded: 0,
            failed: 0,
            names: [],
          },
        },
        incidents: [
          {
            phase: "start",
            category: "hook-skip",
            summary: "agent start requested skip",
            recovered: true,
          },
        ],
      },
    };

    expect(endCtx.endSummary.finalOutcome.producedVisibleOutput).toBe(false);
    expect(endCtx.endSummary.incidents).toHaveLength(1);
    expect("incidents" in endCtx.endSummary.finalOutcome).toBe(false);
  });

  it("prompt scope exposes roundContext/scenario/capabilities", async () => {
    const emitPromptBlocksSpy = vi.fn().mockResolvedValue({
      sections: [
        { name: "identity", content: "<identity>identity</identity>", cacheable: true },
        { name: "policy", content: "<policy>policy</policy>", cacheable: true },
        { name: "situation", content: "<situation>situation</situation>", cacheable: false },
      ],
      stableBlock: "<identity>identity</identity>\n\n<policy>policy</policy>",
      dynamicBlock: "<situation>situation</situation>",
      stableSignature: "stable-signature",
    });

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
        render: vi.fn(),
        emitPromptBlocks: emitPromptBlocksSpy,
        registerFragmentSource: vi.fn(() => () => undefined),
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
          promptFragments: [],
          toolFilter: { include: [], exclude: [] },
          styleFragment: null,
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

    expect(emitPromptBlocksSpy).toHaveBeenCalledWith(
      "system",
      expect.objectContaining({
        percept: expect.any(Object),
        roundContext: expect.any(Object),
        scenario: expect.any(Object),
        capabilities: expect.any(Object),
      }),
      expect.objectContaining({ providerType: "openai" }),
    );

    const scope = emitPromptBlocksSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(scope.roundContext).toBeTruthy();
    expect(scope.scenario).toBeTruthy();
    expect(scope.capabilities).toBeTruthy();
  });
});
