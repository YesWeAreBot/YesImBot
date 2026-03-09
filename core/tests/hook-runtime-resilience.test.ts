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
import { CorePlugin } from "../src/services/plugin/builtin/core";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";
import type { Percept } from "../src/services/shared/types";

type LoopHarness = ReturnType<typeof createLoopHarness>;
type MessageHarness = ReturnType<typeof createMessageHarness>;

function createLoopHarness(actionPayload: string) {
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn(),
  } as unknown as Record<string, unknown>;

  const hookService = new HookService(rootCtx as never);
  const hookWarnSpy = vi.fn();
  (hookService as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger = {
    warn: hookWarnSpy,
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
    bots: [],
    "yesimbot.plugin": pluginRegistry,
    "yesimbot.horizon": {
      lookupNativeMsgId: vi.fn(() => null),
    },
  } as unknown as Record<string, unknown>;

  const hookService = new HookService(rootCtx as never);
  const hookWarnSpy = vi.fn();
  (hookService as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger = {
    warn: hookWarnSpy,
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
    const actionEventPayload = harness.horizonEvents.recordAgentAction.mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ status?: string }> };
    };
    expect(actionEventPayload.data?.toolResults?.[0]?.status).toBe("ok");
  });

  it("times out slow Message before-hook and still sends original content", async () => {
    const harness: MessageHarness = createMessageHarness();
    const sessionSend = vi.fn(async () => undefined);
    let hookCompleted = false;

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Message,
      phase: HookPhase.Before,
      timeout: 25,
      handler: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        hookCompleted = true;
        const params = ctx.params as { content: string; session: unknown };
        return {
          modified: true,
          params: { ...params, content: "HOOKED MESSAGE" },
        };
      },
    });

    const result = await harness.plugin.sendMessage(
      { content: "original message" },
      {
        platform: "discord",
        channelId: "c-1",
        session: { send: sessionSend } as never,
        percept: { traceId: "trace-message-timeout" } as never,
      },
    );

    expect(result.success).toBe(true);
    expect(hookCompleted).toBe(false);
    expect(sessionSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sessionSend.mock.calls[0]?.[0])).toContain("original message");
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

  it("isolates Message before-hook errors and still sends the final user-facing message", async () => {
    const harness: MessageHarness = createMessageHarness();
    const sessionSend = vi.fn(async () => undefined);

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: async () => {
        throw new Error("message before failure");
      },
    });
    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        const params = ctx.params as { content: string; session: unknown };
        return {
          modified: true,
          params: { ...params, content: "message still delivered" },
        };
      },
    });

    const result = await harness.plugin.sendMessage(
      { content: "original message" },
      {
        platform: "discord",
        channelId: "c-1",
        session: { send: sessionSend } as never,
        percept: { traceId: "trace-message-error" } as never,
      },
    );

    expect(result.success).toBe(true);
    expect(sessionSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sessionSend.mock.calls[0]?.[0])).toContain("message still delivered");
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
    const actionEventPayload = harness.horizonEvents.recordAgentAction.mock.calls[0]?.[0] as {
      data?: { toolResults?: Array<{ status?: string }> };
    };
    expect(actionEventPayload.data?.toolResults?.[0]?.status).toBe("ok");
    expect(harness.hookWarnSpy).toHaveBeenCalledTimes(1);
  });
});
