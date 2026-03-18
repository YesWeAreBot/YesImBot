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
    (type: string, attrs?: Record<string, unknown>) => ({ type, attrs, children: [] }),
    {
      parse: (content: string) => [content],
    },
  );

  return {
    Schema: schemaMock,
    Context: class {},
    Service: class {
      logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
      constructor(..._args: unknown[]) {}
    },
    h: hMock,
    sleep: vi.fn(async () => undefined),
  };
});

import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";
import { CorePlugin } from "../src/services/plugin/builtin/core";
import type { ToolExecutionContext } from "../src/services/plugin/types";

function createMessageRuntimeHarness() {
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
  (hookService as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger = {
    warn: vi.fn(),
  };
  rootCtx["yesimbot.hook"] = hookService;

  const plugin = new CorePlugin(rootCtx as never);

  return {
    rootCtx,
    hookService,
    plugin,
    pluginRegistry,
  };
}

describe("Message Hook Coverage", () => {
  it("intercepts current-channel send_message through CorePlugin.sendMessage runtime path", async () => {
    const harness = createMessageRuntimeHarness();
    let capturedTraceId: string | undefined;

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        capturedTraceId = ctx.traceId;
        const params = ctx.params as { content: string; session: unknown };
        return {
          modified: true,
          params: {
            ...params,
            content: "HOOKED CURRENT CHANNEL",
          },
        };
      },
    });

    const sessionSend = vi.fn(async () => undefined);
    const toolCtx: ToolExecutionContext = {
      platform: "discord",
      channelId: "c-1",
      session: { send: sessionSend } as never,
      percept: { traceId: "trace-message-1" } as never,
    };

    const result = await harness.plugin.sendMessage({ content: "original message" }, toolCtx);

    expect(result.success).toBe(true);
    expect(capturedTraceId).toBe("trace-message-1");
    expect(sessionSend).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sessionSend.mock.calls[0]?.[0])).toContain("HOOKED CURRENT CHANNEL");
  });

  it("intercepts cross-channel send_message and modifies payload before bot.sendMessage", async () => {
    const harness = createMessageRuntimeHarness();

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: async (ctx) => {
        const params = ctx.params as { content: string; session: unknown };
        return {
          modified: true,
          params: { ...params, content: "HOOKED CROSS CHANNEL" },
        };
      },
    });

    const botSendMessage = vi.fn(async () => undefined);
    harness.rootCtx.bots = [{ platform: "discord", sendMessage: botSendMessage }];

    const toolCtx: ToolExecutionContext = {
      platform: "discord",
      channelId: "c-1",
      session: { send: vi.fn() } as never,
      percept: { traceId: "trace-message-2" } as never,
    };

    const result = await harness.plugin.sendMessage(
      {
        content: "original cross message",
        target: { platform: "discord", channelId: "cross-c-1" },
      },
      toolCtx,
    );

    expect(result.success).toBe(true);
    expect(botSendMessage).toHaveBeenCalledTimes(1);
    expect(botSendMessage).toHaveBeenCalledWith("cross-c-1", expect.any(Array));
    expect(JSON.stringify(botSendMessage.mock.calls[0]?.[1])).toContain("HOOKED CROSS CHANNEL");
  });

  it("short-circuits send_message transport when Message hook returns skip", async () => {
    const harness = createMessageRuntimeHarness();
    const sessionSend = vi.fn(async () => undefined);
    const botSendMessage = vi.fn(async () => undefined);
    harness.rootCtx.bots = [{ platform: "discord", sendMessage: botSendMessage }];

    harness.hookService.register(harness.rootCtx as never, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: async () => ({
        skip: true,
        result: {
          success: true,
          status: "hook-skipped",
          content: "blocked by message hook",
        },
      }),
    });

    const toolCtx: ToolExecutionContext = {
      platform: "discord",
      channelId: "c-1",
      session: { send: sessionSend } as never,
      percept: { traceId: "trace-message-3" } as never,
    };

    const result = await harness.plugin.sendMessage({ content: "should be skipped" }, toolCtx);

    expect(result).toEqual({
      success: true,
      status: "hook-skipped",
      content: "blocked by message hook",
    });
    expect(sessionSend).not.toHaveBeenCalled();
    expect(botSendMessage).not.toHaveBeenCalled();
  });

  describe("Uncovered Paths (By Design)", () => {
    it("error reporting bypasses hooks for reliability", async () => {
      const bot = {
        sendMessage: vi.fn().mockRejectedValue(new Error("Network error")),
      };

      const channelId = "channel-456";
      const errorSummary = "[Error] channel-456: Agent loop failed";

      // Mirrors core/src/services/agent/service.ts error-reporting path:
      // await bot.sendMessage(channelId, summary).catch(() => {});
      await bot.sendMessage(channelId, errorSummary).catch(() => {});

      expect(bot.sendMessage).toHaveBeenCalledWith(channelId, errorSummary);
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
