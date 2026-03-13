import { describe, expect, it, vi } from "vitest";

import { ThinkActLoop } from "../src/services/agent/loop";
import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";
import {
  getMarkedEvents,
  getMessageCount,
  getParticipants,
  getRecentTurns,
} from "../src/services/runtime/scenario-timeline";
import type { Percept } from "../src/services/shared/types";
import {
  createAgentActionRecord,
  createMessageRecord,
  createSummaryRecord,
} from "./fixtures/timeline-entries";

describe("Full context access contract", () => {
  it("allows agent hook and tool handler to directly consume view/traits/skills/percept metadata", async () => {
    const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
    const rootCtx = {
      baseDir: "/tmp",
      logger: vi.fn(() => agentLogger),
      on: vi.fn(),
      emit: vi.fn(),
    } as unknown as Record<string, unknown>;

    const hookService = new HookService(rootCtx as never);
    (hookService as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger = {
      warn: vi.fn(),
    };

    let hookParams:
      | {
          view: { self: { id: string } };
          traits: Array<{ dimension: string }>;
          skills: Array<{ name: string }>;
          percept: Percept;
          metadata?: Record<string, unknown>;
          skillState?: { active: string[] };
        }
      | undefined;
    let capturedToolCtx: ToolExecutionContext | undefined;

    hookService.register(rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        hookParams = ctx.params as typeof hookParams;
        const params = ctx.params as {
          view: { self: { id: string } };
          traits: Array<{ dimension: string; value: string; confidence: number }>;
          skills: Array<{ name: string; effects: string[]; metadata?: Record<string, unknown> }>;
          percept: Percept;
          metadata?: Record<string, unknown>;
          skillState?: { active: string[] };
        };

        return {
          modified: true,
          params: {
            ...params,
            traits: [...params.traits, { dimension: "hook-injected", value: "yes", confidence: 1 }],
            skills: [
              ...params.skills,
              {
                name: "hook-context-check",
                effects: ["runtime-visible"],
                metadata: { injectedBy: "agent-hook" },
              },
            ],
            metadata: {
              ...(params.metadata ?? {}),
              route: "agent-start",
            },
            skillState: {
              active: ["answering", "hook-context-check"],
            },
          },
        };
      },
    });

    const history = [
      createSummaryRecord({
        index: 1,
        minutesOffset: 1,
        data: {
          content: "summary boundary",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 2,
        minutesOffset: 2,
        data: {
          senderId: "user-123",
          senderName: "Alice",
          content: "hello timeline",
        },
      }),
      createAgentActionRecord({
        index: 1,
        minutesOffset: 3,
        data: {
          actions: [{ name: "inspect_context", params: { input: "ok" } }],
          toolResults: [
            { name: "inspect_context", success: false, error: "timeout" },
            { name: "send_message", success: true, status: "ok", result: { content: "done" } },
          ],
        },
      }),
    ];

    const horizonService = {
      buildView: vi.fn(async () => ({
        self: { id: "bot-1", name: "Athena" },
        environment: {
          type: "guild",
          id: "c-1",
          name: "Test Channel",
          platform: "discord",
          channelId: "c-1",
        },
        entities: [{ id: "user-123", type: "user", name: "Alice", userId: "user-123" }],
        history,
      })),
      formatHorizonText: vi.fn(async () => [{ role: "user", content: "hello" }]),
      events: {
        recordAgentResponse: vi.fn(async () => undefined),
        recordAgentAction: vi.fn(async () => undefined),
        recordMessage: vi.fn(async () => undefined),
        markAsActive: vi.fn(async () => undefined),
        archiveStale: vi.fn(async () => undefined),
      },
      config: {},
      compressor: undefined,
    };

    const traitService = {
      analyze: vi.fn(async () => [
        {
          dimension: "scene",
          value: "group-chat",
          confidence: 0.92,
          metadata: { source: "test" },
        },
      ]),
    };

    const skillService = {
      resolve: vi.fn(() => ({
        activeSkills: [
          {
            name: "answering",
            effects: ["concise"],
            metadata: { origin: "test-skill" },
          },
        ],
        promptInjections: [],
        styleOverride: undefined,
        toolFilter: undefined,
      })),
    };

    const promptService = {
      inject: vi.fn(() => () => undefined),
      render: vi.fn(async () => [
        { name: "soul", content: "soul" },
        { name: "instructions", content: "instructions" },
        { name: "extra", content: "extra" },
      ]),
    };

    let modelCalls = 0;
    const modelService = {
      getProvider: vi.fn(() => undefined),
      call: vi.fn(async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: '{"actions":[{"name":"inspect_context","params":{"input":"ok"}}]}',
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
      }),
    };

    const pluginService = {
      getDefinition: vi.fn(() => ({ type: FunctionType.Tool })),
      invoke: vi.fn(async (_name: string, _params: Record<string, unknown>, ctx) => {
        capturedToolCtx = ctx as ToolExecutionContext;
        return { success: true, status: "ok", content: "done" };
      }),
      getTools: vi.fn(() => []),
    };

    rootCtx["yesimbot.horizon"] = horizonService;
    rootCtx["yesimbot.plugin"] = pluginService;
    rootCtx["yesimbot.prompt"] = promptService;
    rootCtx["yesimbot.model"] = modelService;
    rootCtx["yesimbot.trait"] = traitService;
    rootCtx["yesimbot.skill"] = skillService;
    rootCtx["yesimbot.hook"] = hookService;

    const loop = new ThinkActLoop(
      rootCtx as never,
      {
        model: "mock:model",
        maxRounds: 1,
        debugLevel: 0,
      } as never,
    );

    const percept: Percept = {
      id: "p-1",
      traceId: "trace-ctx-1",
      type: "direct",
      platform: "discord",
      channelId: "c-1",
      timestamp: new Date(),
      metadata: { requestId: "req-123", custom: { lane: "a" } },
    };

    const toolCtx: ToolExecutionContext = {
      platform: "discord",
      channelId: "c-1",
      session: {} as never,
      bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
    };

    const result = await loop.run(percept, toolCtx);

    expect(result.totalToolCalls).toBe(1);
    expect(hookParams).toBeDefined();
    expect(hookParams?.view.self.id).toBe("bot-1");
    expect(hookParams?.traits[0].dimension).toBe("scene");
    expect(hookParams?.skills ?? []).toEqual([]);
    expect(hookParams?.percept.traceId).toBe("trace-ctx-1");
    expect(hookParams?.percept.metadata).toEqual({ requestId: "req-123", custom: { lane: "a" } });
    expect(hookParams?.metadata).toEqual(
      expect.objectContaining({
        channelKey: "discord:c-1",
        traceId: "trace-ctx-1",
      }),
    );
    expect(hookParams?.skillState).toMatchObject({ active: [] });

    expect(capturedToolCtx).toBeDefined();
    expect(capturedToolCtx?.view?.self.id).toBe("bot-1");
    expect(capturedToolCtx?.traits?.[0].dimension).toBe("scene");
    expect(capturedToolCtx?.traits?.map((t) => t.dimension)).toContain("hook-injected");
    expect(capturedToolCtx?.skills?.[0].name).toBe("hook-context-check");
    expect(capturedToolCtx?.skills?.map((s) => s.name)).toContain("hook-context-check");
    expect(capturedToolCtx?.percept?.traceId).toBe("trace-ctx-1");
    expect(capturedToolCtx?.percept?.metadata).toEqual({
      requestId: "req-123",
      custom: { lane: "a" },
    });
    expect(capturedToolCtx?.roundContext?.snapshot.metadata).toEqual(
      expect.objectContaining({
        channelKey: "discord:c-1",
        traceId: "trace-ctx-1",
        route: "agent-start",
      }),
    );
    expect(capturedToolCtx?.roundContext?.skillState).toMatchObject({
      active: ["hook-context-check"],
    });
    expect(capturedToolCtx?.scenario).toBe(capturedToolCtx?.roundContext?.snapshot.scenario);
    expect(capturedToolCtx?.capabilities).toBe(
      capturedToolCtx?.roundContext?.snapshot.capabilities,
    );

    const scenarioTimeline = capturedToolCtx?.roundContext?.snapshot.scenario.raw.scenarioTimeline;
    expect(scenarioTimeline).toBeDefined();
    const messageCount = getMessageCount(scenarioTimeline!);
    const participants = getParticipants(scenarioTimeline!);
    const markedEvents = getMarkedEvents(scenarioTimeline!);
    const recentTurns = getRecentTurns(scenarioTimeline!, 1);
    expect(messageCount).toBe(1);
    expect(participants.map((participant) => participant.id)).toContain("user-123");
    expect(markedEvents.some((event) => event.type === "error")).toBe(true);
    expect(recentTurns).toHaveLength(1);
    expect(capturedToolCtx?.roundContext?.snapshot.scenario.derived.recentMetrics).toEqual(
      expect.objectContaining({
        messageCount: 1,
      }),
    );
    expect((horizonService.formatHorizonText as ReturnType<typeof vi.fn>).mock.calls[0]?.[3]).toBe(
      scenarioTimeline,
    );
  });
});
