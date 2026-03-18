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
      ctx: Record<string, unknown>;
      constructor(ctx?: unknown, ..._args: unknown[]) {
        this.ctx = (ctx ?? {}) as Record<string, unknown>;
      }
    },
    Random: {
      id: () => `msg-${Math.random().toString(36).slice(2, 10)}`,
    },
    h: hMock,
    sleep: vi.fn(async () => undefined),
  };
});

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { AgentCore } from "../src/services/agent/service";
import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";
import { CorePlugin } from "../src/services/plugin/builtin/core";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";

type LoopHarness = ReturnType<typeof createLoopHarness>;
type MessageHarness = ReturnType<typeof createMessageHarness>;

function createLoopHarness(actionPayload: string) {
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as Record<string, unknown>;

  const hookService = new HookService(rootCtx as never);
  const hookWarnSpy = vi.fn();
  (
    hookService as unknown as {
      logger: { warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
    }
  ).logger = {
    warn: hookWarnSpy,
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

  let modelCalls = 0;
  const modelService = {
    getProvider: vi.fn(() => undefined),
    call: vi.fn(async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { text: actionPayload, usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
    }),
  };

  const pluginInvoke = vi.fn(async (_name: string, params: Record<string, unknown>) => ({
    success: true,
    status: "ok",
    content: { params },
  }));

  const pluginService = {
    getDefinition: vi.fn(() => ({ type: FunctionType.Tool })),
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
    traceId: "trace-runtime-resilience",
    type: "direct",
    platform: "discord",
    channelId: "c-1",
    timestamp: new Date(),
    metadata: {},
  };

  const toolCtx: ToolExecutionContext = {
    platform: "discord",
    channelId: "c-1",
    session: { send: vi.fn() } as never,
    bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
  };

  return { rootCtx, hookService, hookWarnSpy, loop, percept, toolCtx, pluginInvoke, horizonEvents };
}

function createMessageHarness() {
  const pluginRegistry = {
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
  };

  const rootCtx = {
    logger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
    on: vi.fn(),
    emit: vi.fn(),
    bots: [],
    "yesimbot.plugin": pluginRegistry,
    "yesimbot.horizon": {
      lookupNativeMsgId: vi.fn(() => null),
    },
  } as unknown as Record<string, unknown>;

  const hookService = new HookService(rootCtx as never);
  const hookWarnSpy = vi.fn();
  (
    hookService as unknown as {
      logger: { warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
    }
  ).logger = {
    warn: hookWarnSpy,
    debug: vi.fn(),
  };
  rootCtx["yesimbot.hook"] = hookService;

  const plugin = new CorePlugin(rootCtx as never);

  return { rootCtx, hookService, hookWarnSpy, plugin };
}

describe("Hook runtime resilience (timeout)", () => {
  it("times out slow Tool before-hook in ThinkActLoop and continues with original params", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    let beforeCompleted = false;
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      timeout: 30,
      handler: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        beforeCompleted = true;
        const params = ctx.params as { query: string };
        return { modified: true, params: { ...params, query: "intercepted" } };
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(beforeCompleted).toBe(false);
    expect(harness.pluginInvoke).toHaveBeenCalledWith(
      "search_tool",
      { query: "athena" },
      expect.any(Object),
    );
  });

  it("times out slow Tool after-hook without breaking completed runtime tool flow", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    let afterCompleted = false;
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.After,
      timeout: 30,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        afterCompleted = true;
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(afterCompleted).toBe(false);
    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
    const actionEventPayload = (
      harness.horizonEvents.recordAgentAction.mock.calls as unknown[][]
    )[0]?.[0] as {
      data?: { toolResults?: Array<{ status?: string }> };
    };
    expect(actionEventPayload.data?.toolResults?.[0]?.status).toBe("ok");
  });
});

describe("Hook runtime resilience (error isolation)", () => {
  it("isolates Tool before-hook errors in ThinkActLoop and allows later hooks to continue", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    const order: string[] = [];
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async () => {
        order.push("before-1");
        throw new Error("before failure");
      },
    });
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        order.push("before-2");
        const params = ctx.params as { query: string };
        return {
          modified: true,
          params: { ...params, query: `${params.query}-continued` },
        };
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(order).toEqual(["before-1", "before-2"]);
    expect(harness.pluginInvoke).toHaveBeenCalledWith(
      "search_tool",
      { query: "athena-continued" },
      expect.any(Object),
    );
    expect(harness.hookWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(harness.hookWarnSpy.mock.calls[0]?.[0])).toContain("Hook");
  });

  it("isolates Agent before-hook errors and keeps runtime tool execution alive", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: async () => {
        throw new Error("agent before failure");
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
    expect(harness.hookWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("isolates Tool after-hook errors and preserves completed runtime outcome", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.After,
      handler: async () => {
        throw new Error("after hook failure");
      },
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(harness.pluginInvoke).toHaveBeenCalledTimes(1);
    const actionEventPayload = (
      harness.horizonEvents.recordAgentAction.mock.calls as unknown[][]
    )[0]?.[0] as {
      data?: { toolResults?: Array<{ status?: string }> };
    };
    expect(actionEventPayload.data?.toolResults?.[0]?.status).toBe("ok");
    expect(harness.hookWarnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Hook runtime resilience (error hooks)", () => {
  it("fires tool error hook when tool invocation throws", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    const errorHookSpy = vi.fn();
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Tool,
      phase: HookPhase.Error,
      handler: async (ctx) => {
        errorHookSpy(ctx.error);
      },
    });

    harness.pluginInvoke.mockImplementationOnce(async () => {
      throw new Error("tool failure");
    });

    const runResult = await harness.loop.run(harness.percept, harness.toolCtx);

    expect(runResult.totalToolCalls).toBe(1);
    expect(errorHookSpy).toHaveBeenCalledTimes(1);
    expect(errorHookSpy.mock.calls[0]?.[0]).toEqual(expect.any(Error));
  });
});

describe("Hook runtime resilience (agent snapshot)", () => {
  it("shares agent before-hook committed view between prompt rendering and tool context", async () => {
    const harness: LoopHarness = createLoopHarness(
      '{"actions":[{"name":"search_tool","params":{"query":"athena"}}]}',
    );

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        const params = ctx.params as { view: Record<string, unknown> };
        return {
          modified: true,
          params: {
            ...params,
            scenario: {
              ...((ctx.params as { scenario: Record<string, unknown> }).scenario ?? {}),
              derived: {
                ...((ctx.params as { scenario: { derived?: Record<string, unknown> } }).scenario
                  ?.derived ?? {}),
                testMarker: "from-hook",
              },
            },
          },
        };
      },
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    const promptArgs = (
      harness.rootCtx["yesimbot.prompt"] as {
        emitPromptBlocks: ReturnType<typeof vi.fn>;
      }
    ).emitPromptBlocks.mock.calls[0]?.[1] as unknown as {
      scenario?: { derived?: Record<string, unknown> };
    };
    const toolCtxArg = (harness.pluginInvoke.mock.calls as unknown[][])[0]?.[2] as {
      scenario?: { derived?: Record<string, unknown> };
    };

    expect(promptArgs?.scenario?.derived?.testMarker).toBe("from-hook");
    expect(toolCtxArg?.scenario?.derived?.testMarker).toBe("from-hook");
  });
});

describe("Hook runtime resilience (fail-safe boundary)", () => {
  it("runs fail-safe error transport after lifecycle closure and outside message hooks", async () => {
    const order: string[] = [];
    const sendSpy = vi.fn(async () => {
      order.push("report-error");
    });

    const ctx = {
      logger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        level: 0,
      })),
      command: vi.fn(),
      on: vi.fn(),
      setInterval: vi.fn(),
      emit: vi.fn(),
      bots: [{ platform: "discord", sendMessage: sendSpy }],
    } as unknown as Record<string, unknown>;

    const hookService = new HookService(ctx as never);
    ctx["yesimbot.hook"] = hookService;

    const agent = new AgentCore(
      ctx as never,
      {
        debugLevel: 0,
        errorReportChannel: "discord:ops-channel",
      } as never,
    );

    (
      agent as unknown as {
        loop: { run: (percept: unknown, toolCtx: unknown) => Promise<unknown> };
      }
    ).loop = {
      run: async () => {
        order.push("agent-end");
        throw new Error("runtime failed after lifecycle close");
      },
    };
    (
      agent as unknown as { willingness: { recordBotReply: ReturnType<typeof vi.fn> } }
    ).willingness = {
      recordBotReply: vi.fn(),
    };

    await (
      agent as unknown as {
        runLoop: (
          channelKey: string,
          built: { percept: Percept; toolCtx: ToolExecutionContext },
        ) => Promise<void>;
      }
    ).runLoop("discord:c-1", {
      percept: {
        id: "p-failsafe",
        traceId: "trace-failsafe",
        type: "direct",
        platform: "discord",
        channelId: "c-1",
        timestamp: new Date("2026-03-12T00:00:00Z"),
        metadata: {},
      },
      toolCtx: {
        platform: "discord",
        channelId: "c-1",
      } as ToolExecutionContext,
    });

    expect(order).toEqual(["agent-end", "report-error"]);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
