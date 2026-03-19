import { describe, expect, it, vi } from "vitest";

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { Hook } from "../src/services/hook/decorators";
import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";
import { YesImPlugin } from "../src/services/plugin/plugin";
import {
  FunctionType,
  type RuntimeToolExecutionContext,
  type ToolExecutionContext,
} from "../src/services/plugin/types";

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

  const skillService = {
    resolve: vi.fn(() => ({
      activeSkills: [{ name: "answering", effects: ["concise"] }],
      promptFragments: [],
      styleFragment: null,
      toolFilter: { include: [], exclude: [] },
    })),
  };

  const promptService = {
    emitPromptBlocks: vi.fn(async () => ({
      sections: [],
      stableBlock: "",
      dynamicBlock: "",
      stableSignature: "sig",
    })),
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
    async (_name: string, params: Record<string, unknown>, ctx: RuntimeToolExecutionContext) => {
      return {
        success: true,
        status: "ok",
        content: {
          params,
            contextSnapshot: {
              attention: ctx.scenario?.derived.attention,
              skillNames: (ctx.skills ?? []).map((s) => s.name),
              perceptTraceId: ctx.percept?.traceId,
            },
        },
      };
    },
  );

  const pluginMountDisposers = new Map<string, Array<() => void>>();

  const pluginService = {
    getDefinition: vi.fn(() => ({ type: FunctionType.Tool })),
    invoke: pluginInvoke,
    executeRoundActions: vi.fn(
      async (
        actions: Array<{ name: string; params?: Record<string, unknown> }>,
        ctx: RuntimeToolExecutionContext,
        traceId: string,
      ) => {
        const toolResults = await Promise.all(
          actions.map(async (action, index) => {
            let params = action.params ?? {};
            const beforeResult = await hookService.executeBefore(HookType.Tool, params, traceId);

            if (beforeResult.skipped) {
              const skippedResult = beforeResult.result as {
                success: boolean;
                status: string;
                content?: unknown;
                error?: string;
              };
              return {
                id: index,
                name: action.name,
                status: skippedResult.status,
                result: skippedResult.content,
                error: skippedResult.error,
                success: skippedResult.success,
              };
            }

            params = beforeResult.params;
            const result = await pluginInvoke(action.name, params, ctx);
            await hookService.executeAfter(HookType.Tool, params, result, traceId);
            return {
              id: index,
              name: action.name,
              status: result.status,
              result: result.content,
              success: result.success,
            };
          }),
        );

        return {
          toolResults,
          hasToolCalls: toolResults.length > 0,
          hasActionCalls: false,
        };
      },
    ),
    getTools: vi.fn(() => []),
    mountPlugin: vi.fn(async (plugin: YesImPlugin) => {
      const disposers = hookService.registerFromDecorators(rootCtx as never, plugin);
      pluginMountDisposers.set(plugin.metadata.name, disposers);
    }),
    unregisterPlugin: vi.fn(),
    unmountPlugin: vi.fn((name: string) => {
      const disposers = pluginMountDisposers.get(name) ?? [];
      for (const dispose of [...disposers].reverse()) {
        dispose();
      }
      pluginMountDisposers.delete(name);
    }),
  };

  rootCtx["yesimbot.horizon"] = horizonService;
  rootCtx["yesimbot.plugin"] = pluginService;
  rootCtx["yesimbot.prompt"] = promptService;
  rootCtx["yesimbot.model"] = modelService;
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
    triggerLifecycle: async (event: string) => {
      for (const callback of lifecycleHandlers.get(event) ?? []) {
        await callback();
      }
    },
    horizonEvents,
    promptRender: promptService.emitPromptBlocks,
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
          skills: Array<{ name: string; effects: string[] }>;
          scenario: { derived: Record<string, unknown> };
          capabilities: { extended: Record<string, unknown> };
          metadata?: Record<string, unknown>;
        };
        return {
          modified: true,
          params: {
            ...params,
            skills: [...params.skills, { name: "hooked-skill", effects: ["runtime-tuned"] }],
            scenario: {
              ...params.scenario,
              derived: {
                ...params.scenario.derived,
                attention: { lane: "hooked" },
              },
            },
            capabilities: {
              ...params.capabilities,
              extended: {
                ...params.capabilities.extended,
                directMessage: { status: "available" },
              },
            },
            metadata: {
              ...params.metadata,
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
    const invokeCtx = harness.pluginInvoke.mock.calls[0]![2] as RuntimeToolExecutionContext;
    expect(invokeCtx.skills ?? []).toEqual([]);
    expect(invokeCtx.scenario?.derived.attention).toEqual({ lane: "hooked" });
    expect(invokeCtx.capabilities?.extended.directMessage).toEqual({ status: "available" });
    expect(invokeCtx.roundContext?.snapshot.metadata).toMatchObject({ hookRevision: "start-1" });
    expect(invokeCtx.roundContext?.skillState).toMatchObject({ active: [] });
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
      expect.objectContaining({ providerType: undefined }),
    );

    const actionEventPayload = (
      harness.horizonEvents.recordAgentAction as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ result?: Record<string, unknown> }> };
    };
    expect(
      (
        actionEventPayload.data?.toolResults?.[0]?.result?.contextSnapshot as {
          attention?: Record<string, unknown>;
        }
      )?.attention,
    ).toEqual({ lane: "hooked" });
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

    const actionEventPayload = (
      harness.horizonEvents.recordAgentAction as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as {
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
    const actionEventPayload = (
      harness.horizonEvents.recordAgentAction as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ status?: string; result?: string }> };
    };
    expect(actionEventPayload.data?.toolResults?.[0]).toMatchObject({
      status: "hook-skipped",
      result: "blocked by hook",
    });
  });

  it("does not globally skip rounds when no Agent before-hook is registered", async () => {
    const harness: RuntimeHarness = createRuntimeHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"baseline"}}]}',
    );

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
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
    await harness.triggerLifecycle("ready");

    expect(harness.pluginRegistry.mountPlugin).toHaveBeenCalledWith(plugin);
    expect(harness.hookService.getHooks(HookType.Agent, HookPhase.Before)).toHaveLength(1);

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(0);
    expect(harness.pluginInvoke).not.toHaveBeenCalled();

    await harness.triggerLifecycle("dispose");
    expect(harness.hookService.getHooks(HookType.Agent, HookPhase.Before)).toHaveLength(0);
    expect(harness.pluginRegistry.unmountPlugin).toHaveBeenCalled();
  });
});
