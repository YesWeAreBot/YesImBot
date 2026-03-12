import { describe, expect, it, vi } from "vitest";

import { ThinkActLoop } from "../src/services/agent/loop";
import { Hook } from "../src/services/hook/decorators";
import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";
import { YesImPlugin } from "../src/services/plugin/plugin";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";
import type { Percept } from "../src/services/shared/types";

type RuntimeHarness = ReturnType<typeof createRuntimeHarness>;

function createRuntimeHarness(actionPayload: string) {
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const lifecycleHandlers = new Map<string, Array<() => void>>();
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn((event: string, handler: () => void) => {
      const handlers = lifecycleHandlers.get(event) ?? [];
      handlers.push(handler);
      lifecycleHandlers.set(event, handlers);
    }),
    emit: vi.fn(),
  } as unknown as Record<string, unknown>;

  const hookService = new HookService(rootCtx as never);
  (
    hookService as unknown as {
      logger: { warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
    }
  ).logger = {
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const horizonEvents = {
    recordAgentResponse: vi.fn(async () => undefined),
    recordAgentAction: vi.fn(async () => undefined),
    recordMessage: vi.fn(async () => undefined),
    markAsActive: vi.fn(async () => undefined),
    archiveStale: vi.fn(async () => undefined),
  };

  const horizonService = {
    buildView: vi.fn(async () => ({
      self: { id: "bot-1", name: "Athena", role: "assistant" },
      entities: [],
      history: [],
    })),
    formatHorizonText: vi.fn(async () => [{ role: "user", content: "hello" }]),
    events: horizonEvents,
    config: {},
    compressor: undefined,
  };

  const traitService = {
    analyze: vi.fn(async () => [
      {
        dimension: "scene",
        value: "group-chat",
        confidence: 0.95,
      },
    ]),
  };

  const skillService = {
    resolve: vi.fn(() => ({
      activeSkills: [{ name: "answering", effects: ["concise"] }],
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
          text: actionPayload,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
    }),
  };

  const pluginInvoke = vi.fn(
    async (_name: string, params: Record<string, unknown>, ctx: ToolExecutionContext) => {
      return {
        success: true,
        status: "ok",
        content: {
          params,
          contextSnapshot: {
            traitDimensions: (ctx.traits ?? []).map((t) => t.dimension),
            skillNames: (ctx.skills ?? []).map((s) => s.name),
            perceptTraceId: ctx.percept?.traceId,
          },
        },
      };
    },
  );

  const pluginService = {
    getDefinition: vi.fn(() => ({ type: FunctionType.Tool })),
    invoke: pluginInvoke,
    getTools: vi.fn(() => []),
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
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
      maxRounds: 2,
      debugLevel: 0,
    } as never,
  );

  const percept: Percept = {
    id: "p-1",
    traceId: "trace-runtime-1",
    type: "direct",
    platform: "discord",
    channelId: "c-1",
    timestamp: new Date(),
    metadata: { requestId: "req-001" },
  };

  const toolCtx: ToolExecutionContext = {
    platform: "discord",
    channelId: "c-1",
    session: {} as never,
    bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
  };

  return {
    rootCtx,
    hookService,
    loop,
    percept,
    toolCtx,
    pluginInvoke,
    pluginRegistry: pluginService,
    triggerLifecycle: (event: string) => {
      for (const callback of lifecycleHandlers.get(event) ?? []) {
        callback();
      }
    },
    horizonEvents,
    promptRender: promptService.render,
  };
}

describe("Hook runtime interception", () => {
  it("runs Agent before-hook through ThinkActLoop and propagates behavior mutations into runtime outputs", async () => {
    const harness: RuntimeHarness = createRuntimeHarness(
      '{"actions":[{"name":"inspect_context","params":{"query":"alpha"}}]}',
    );

    let capturedAgentTraceId: string | undefined;
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        capturedAgentTraceId = ctx.traceId;
        const params = ctx.params as {
          traits: Array<{ dimension: string; value: string; confidence: number }>;
          skills: Array<{ name: string; effects: string[] }>;
        };
        return {
          modified: true,
          params: {
            ...params,
            traits: [
              ...params.traits,
              { dimension: "hook-injected", value: "active", confidence: 1 },
            ],
            skills: [...params.skills, { name: "hooked-skill", effects: ["runtime-tuned"] }],
            scenario: {
              ...((ctx.params as { scenario: { derived: { attention?: Record<string, unknown> } } })
                .scenario ?? {}),
              derived: {
                ...(ctx.params as { scenario: { derived: Record<string, unknown> } }).scenario
                  .derived,
                attention: { lane: "hooked" },
              },
            },
            capabilities: {
              ...(
                ctx.params as {
                  capabilities: { extended: { directMessage: { status: string } } };
                }
              ).capabilities,
              extended: {
                ...(
                  ctx.params as {
                    capabilities: { extended: Record<string, unknown> };
                  }
                ).capabilities.extended,
                directMessage: { status: "available" },
              },
            },
            metadata: {
              ...(
                ctx.params as {
                  metadata?: Record<string, unknown>;
                }
              ).metadata,
              hookRevision: "start-1",
            },
            skillState: {
              active: ["hooked-skill"],
            },
          },
        };
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(capturedAgentTraceId).toBe("trace-runtime-1");
    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
    const invokeCtx = harness.pluginInvoke.mock.calls[0]?.[2] as ToolExecutionContext;
    expect(invokeCtx.traits?.map((t) => t.dimension)).toContain("hook-injected");
    expect(invokeCtx.skills?.map((s) => s.name)).toContain("hooked-skill");
    expect(invokeCtx.scenario?.derived.attention).toEqual({ lane: "hooked" });
    expect(invokeCtx.capabilities?.extended.directMessage).toEqual({ status: "available" });
    expect(invokeCtx.roundContext?.snapshot.metadata).toMatchObject({ hookRevision: "start-1" });
    expect(invokeCtx.roundContext?.skillState).toEqual({ active: ["hooked-skill"] });
    expect(invokeCtx.roundContext?.snapshot.scenario).toBe(invokeCtx.scenario);
    expect(harness.promptRender).toHaveBeenCalledWith(
      "system",
      expect.objectContaining({
        scenario: expect.objectContaining({
          derived: expect.objectContaining({ attention: { lane: "hooked" } }),
        }),
        capabilities: expect.objectContaining({
          extended: expect.objectContaining({ directMessage: { status: "available" } }),
        }),
      }),
    );

    const actionEventPayload = harness.horizonEvents.recordAgentAction.mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ result?: Record<string, unknown> }> };
    };
    expect(
      (
        actionEventPayload.data?.toolResults?.[0]?.result?.contextSnapshot as {
          traitDimensions?: string[];
        }
      )?.traitDimensions,
    ).toContain("hook-injected");
  });

  it("uses Tool before-hook modified params in pluginService.invoke runtime call", async () => {
    const harness: RuntimeHarness = createRuntimeHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        const params = ctx.params as { query: string };
        return {
          modified: true,
          params: { ...params, query: params.query.toUpperCase(), intercepted: true },
        };
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
    expect(harness.pluginInvoke.mock.calls[0]?.[1]).toEqual({
      query: "ATHENA",
      intercepted: true,
    });

    const actionEventPayload = harness.horizonEvents.recordAgentAction.mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ result?: Record<string, unknown> }> };
    };
    expect(
      (actionEventPayload.data?.toolResults?.[0]?.result?.params as Record<string, unknown>) ?? {},
    ).toEqual({
      query: "ATHENA",
      intercepted: true,
    });
  });

  it("short-circuits tool execution when Tool before-hook returns skip result", async () => {
    const harness: RuntimeHarness = createRuntimeHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"ignored","mode":"block"}}]}',
    );

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        const params = ctx.params as { mode?: string };
        if (params.mode === "block") {
          return {
            skip: true,
            result: {
              success: true,
              status: "hook-skipped",
              content: "blocked by hook",
            },
          };
        }
        return { modified: false };
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(harness.pluginInvoke).not.toHaveBeenCalled();
    const actionEventPayload = harness.horizonEvents.recordAgentAction.mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ status?: string; result?: string }> };
    };
    expect(actionEventPayload.data?.toolResults?.[0]).toMatchObject({
      status: "hook-skipped",
      result: "blocked by hook",
    });
  });

  it("registers Agent before-hook decorators from plugin startup and applies skip", async () => {
    const harness: RuntimeHarness = createRuntimeHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"ignored"}}]}',
    );

    class StartupAgentSkipPlugin extends YesImPlugin {
      @Hook({ type: HookType.Agent, phase: HookPhase.Before })
      async skipBeforeAgent() {
        return {
          skip: true,
          result: {
            success: true,
            status: "startup-skip",
            content: "skipped by decorator registration",
          },
        };
      }
    }

    const plugin = new StartupAgentSkipPlugin(harness.rootCtx as never);
    harness.triggerLifecycle("ready");

    expect(harness.pluginRegistry.registerPlugin).toHaveBeenCalledWith(plugin);
    expect(harness.hookService.getHooks(HookType.Agent, HookPhase.Before)).toHaveLength(1);

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(0);
    expect(harness.pluginInvoke).not.toHaveBeenCalled();

    harness.triggerLifecycle("dispose");
    expect(harness.hookService.getHooks(HookType.Agent, HookPhase.Before)).toHaveLength(0);
    expect(harness.pluginRegistry.unregisterPlugin).toHaveBeenCalled();
  });
});
