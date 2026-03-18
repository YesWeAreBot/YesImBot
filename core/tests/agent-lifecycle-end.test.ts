import { describe, expect, it, vi } from "vitest";

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

  const schemaMock = new Proxy(
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

  const hMock = Object.assign(
    (type: string, attrs?: Record<string, unknown>, children?: unknown[]) => ({
      type,
      attrs,
      children: children ?? [],
    }),
    {
      parse: (content: string) => [content],
    },
  );

  return {
    Schema: schemaMock,
    Context: class {},
    Service: class {
      logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), level: 0 };
      constructor(..._args: unknown[]) {}
    },
    Random: {
      id: () => `msg-${Math.random().toString(36).slice(2, 10)}`,
    },
    h: hMock,
    sleep: vi.fn(async () => undefined),
  };
});

import { ThinkActLoop } from "../src/services/agent/loop";
import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";
import type { AgentEndSummary } from "../src/services/runtime/contracts";
import type { Percept } from "../src/services/shared/types";

type EndHookParams = {
  lifecycle: "end";
  roundContext: ToolExecutionContext["roundContext"];
  scenario: ToolExecutionContext["scenario"];
  capabilities: ToolExecutionContext["capabilities"];
  endSummary: AgentEndSummary;
};

function createHarness(options?: {
  modelReplies?: string[];
  invokeImpl?: (
    name: string,
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ) => Promise<{ success: boolean; status: string; content?: unknown; error?: string }>;
}) {
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as Record<string, unknown>;

  const hookService = new HookService(rootCtx as never);
  (
    hookService as unknown as {
      log: { warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
    }
  ).log = {
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
      environment: {
        type: "group",
        id: "c-1",
        name: "general",
        platform: "discord",
        channelId: "c-1",
      },
      entities: [],
      history: [],
    })),
    formatHorizonText: vi.fn(async () => [{ role: "user", content: "hello" }]),
    events: horizonEvents,
    config: {},
    compressor: undefined,
  };

  const traitService = {
    analyze: vi.fn(async () => [{ dimension: "scene", value: "group-chat", confidence: 0.9 }]),
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

  let replyIndex = 0;
  const replies = options?.modelReplies ?? [
    '{"actions":[{"name":"send_message","params":{"content":"hello"}}]}',
    "",
  ];
  const modelService = {
    getProvider: vi.fn(() => undefined),
    call: vi.fn(async () => {
      const text = replies[replyIndex] ?? "";
      replyIndex += 1;
      return { text, usage: { inputTokens: 1, outputTokens: 1 } };
    }),
  };

  const pluginInvoke = vi.fn(
    options?.invokeImpl ??
      (async (_name: string, params: Record<string, unknown>, ctx: ToolExecutionContext) => ({
        success: true,
        status: "ok",
        content: {
          params,
          contextSnapshot: {
            roundContext: ctx.roundContext,
            scenario: ctx.scenario,
            capabilities: ctx.capabilities,
          },
        },
      })),
  );

  const pluginService = {
    getDefinition: vi.fn((name: string) => {
      if (name === "send_message") {
        return { type: FunctionType.Action };
      }
      return { type: FunctionType.Tool };
    }),
    invoke: pluginInvoke,
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
      maxRounds: 2,
      debugLevel: 0,
    } as never,
  );

  const percept: Percept = {
    id: "p-1",
    traceId: "trace-agent-end",
    type: "direct",
    platform: "discord",
    channelId: "c-1",
    timestamp: new Date("2026-03-12T00:00:00Z"),
    metadata: {},
  };

  const toolCtx: ToolExecutionContext = {
    platform: "discord",
    channelId: "c-1",
    session: { send: vi.fn() } as never,
    bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
  };

  return {
    rootCtx,
    hookService,
    loop,
    percept,
    toolCtx,
    pluginInvoke,
    modelCall: modelService.call,
  };
}

describe("Agent lifecycle end", () => {
  it("fires agent end exactly once for success and silent completions", async () => {
    const successHarness = createHarness({
      modelReplies: ['{"actions":[{"name":"send_message","params":{"content":"hello"}}]}'],
    });
    const successEndSpy = vi.fn();
    successHarness.hookService.register(successHarness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.After,
      handler: async (ctx) => {
        successEndSpy(ctx.params);
      },
    });

    await successHarness.loop.run(successHarness.percept, successHarness.toolCtx);

    expect(successEndSpy).toHaveBeenCalledTimes(1);
    const successParams = successEndSpy.mock.calls[0]?.[0] as EndHookParams;
    expect(successParams.lifecycle).toBe("end");
    expect(successParams.endSummary.finalOutcome.status).toBe("success");
    expect(successParams.endSummary.finalOutcome.producedVisibleOutput).toBe(true);

    const silentHarness = createHarness({
      modelReplies: ['{"actions":[]}'],
    });
    const silentEndSpy = vi.fn();
    silentHarness.hookService.register(silentHarness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.After,
      handler: async (ctx) => {
        silentEndSpy(ctx.params);
      },
    });

    await silentHarness.loop.run(silentHarness.percept, silentHarness.toolCtx);

    expect(silentEndSpy).toHaveBeenCalledTimes(1);
    const silentParams = silentEndSpy.mock.calls[0]?.[0] as EndHookParams;
    expect(silentParams.endSummary.finalOutcome.status).toBe("silent");
    expect(silentParams.endSummary.finalOutcome.producedVisibleOutput).toBe(false);
  });

  it("fires agent end for start skip, runtime failure, and recovered tool error with incidents", async () => {
    const skipHarness = createHarness();
    const skipEndSpy = vi.fn();
    skipHarness.hookService.register(skipHarness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: async () => ({ skip: true, result: { reason: "skip" } }),
    });
    skipHarness.hookService.register(skipHarness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.After,
      handler: async (ctx) => {
        skipEndSpy(ctx.params);
      },
    });

    await skipHarness.loop.run(skipHarness.percept, skipHarness.toolCtx);

    expect(skipEndSpy).toHaveBeenCalledTimes(1);
    const skipParams = skipEndSpy.mock.calls[0]?.[0] as EndHookParams;
    expect(skipParams.endSummary.finalOutcome.status).toBe("skipped");
    expect(skipParams.endSummary.incidents.some((item) => item.category === "hook-skip")).toBe(
      true,
    );

    const failedHarness = createHarness();
    const failedEndSpy = vi.fn();
    failedHarness.hookService.register(failedHarness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.After,
      handler: async (ctx) => {
        failedEndSpy(ctx.params);
      },
    });
    failedHarness.modelCall.mockRejectedValueOnce(new Error("model crashed"));

    await expect(
      failedHarness.loop.run(failedHarness.percept, failedHarness.toolCtx),
    ).rejects.toThrow("model crashed");

    expect(failedEndSpy).toHaveBeenCalledTimes(1);
    const failedParams = failedEndSpy.mock.calls[0]?.[0] as EndHookParams;
    expect(failedParams.endSummary.finalOutcome.status).toBe("failed");
    expect(
      failedParams.endSummary.incidents.some((item) => item.category === "runtime-error"),
    ).toBe(true);

    const recoveredHarness = createHarness({
      modelReplies: ['{"actions":[{"name":"search_tool","params":{"query":"x"}}]}', ""],
      invokeImpl: async () => {
        throw new Error("tool crashed");
      },
    });
    const recoveredEndSpy = vi.fn();
    recoveredHarness.hookService.register(recoveredHarness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.After,
      handler: async (ctx) => {
        recoveredEndSpy(ctx.params);
      },
    });

    await recoveredHarness.loop.run(recoveredHarness.percept, recoveredHarness.toolCtx);

    expect(recoveredEndSpy).toHaveBeenCalledTimes(1);
    const recoveredParams = recoveredEndSpy.mock.calls[0]?.[0] as EndHookParams;
    expect(recoveredParams.endSummary.finalOutcome.status).toBe("degraded");
    expect(
      recoveredParams.endSummary.incidents.some(
        (item) => item.category === "tool-error" && item.recovered,
      ),
    ).toBe(true);
  });

  it("exposes the same committed roundContext shape at agent end as runtime tool consumers", async () => {
    const harness = createHarness({
      modelReplies: ['{"actions":[{"name":"search_tool","params":{"query":"x"}}]}', ""],
    });

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        const params = ctx.params as {
          scenario: Record<string, unknown>;
          capabilities: Record<string, unknown>;
          metadata: Record<string, unknown>;
          skillState: { active: string[] };
        };
        return {
          modified: true,
          params: {
            ...params,
            scenario: {
              ...params.scenario,
              derived: {
                ...((params.scenario.derived as Record<string, unknown>) ?? {}),
                attention: { lane: "hooked" },
              },
            },
            capabilities: {
              ...params.capabilities,
              extended: {
                ...((params.capabilities.extended as Record<string, unknown>) ?? {}),
                directMessage: { status: "available" },
              },
            },
            metadata: {
              ...params.metadata,
              hookRevision: "end-shape-1",
            },
            skillState: {
              active: ["hooked-skill"],
            },
          },
        };
      },
    });

    const endSpy = vi.fn();
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.After,
      handler: async (ctx) => {
        endSpy(ctx.params);
      },
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);

    const toolCtxArg = harness.pluginInvoke.mock.calls[0]?.[2] as ToolExecutionContext;
    const endParams = endSpy.mock.calls[0]?.[0] as EndHookParams;

    expect(endParams.roundContext).toStrictEqual(toolCtxArg.roundContext);
    expect(endParams.scenario).toStrictEqual(toolCtxArg.roundContext?.snapshot.scenario);
    expect(endParams.capabilities).toStrictEqual(toolCtxArg.roundContext?.snapshot.capabilities);
    expect(endParams.roundContext?.snapshot.metadata).toMatchObject({
      hookRevision: "end-shape-1",
    });
    expect(endParams.roundContext?.skillState).toMatchObject({ active: [] });
  });
});
