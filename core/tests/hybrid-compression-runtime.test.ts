import { describe, expect, it, vi } from "vitest";

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { HookType } from "../src/services/hook/types";
import {
  FunctionType,
  type RoundActionCall,
  type RoundActionExecutionResult,
  type ToolExecutionContext,
} from "../src/services/plugin/types";

type CompressionHarnessOptions = {
  isHeartbeat?: boolean;
  maybeCompressImpl?: () => Promise<void>;
};

function createCompressionHarness(options: CompressionHarnessOptions = {}) {
  const { isHeartbeat = false, maybeCompressImpl } = options;
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as Record<string, unknown>;

  const horizonEvents = {
    recordAgentResponse: vi.fn(async () => undefined),
    recordAgentAction: vi.fn(async () => undefined),
    recordMessage: vi.fn(async () => undefined),
    markAsActive: vi.fn(async () => undefined),
    archiveStale: vi.fn(async () => undefined),
  };

  const compressor = {
    maybeCompress: vi.fn(maybeCompressImpl ?? (async () => undefined)),
    compress: vi.fn(async () => undefined),
  };

  const horizonService = {
    buildView: vi.fn(async () => ({
      self: { id: "bot-1", name: "Athena", role: "assistant" },
      entities: [],
      history: [],
    })),
    formatHorizonText: vi.fn(async () => [{ role: "user", content: "hello" }]),
    events: horizonEvents,
    config: { archiveThresholdMs: 60_000 },
    compressor,
  };

  const skillService = {
    resolve: vi.fn(() => ({
      activeSkills: [],
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
          text: '{"actions":[{"name":"send_message","params":{"content":"hello"}}]}',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
    }),
  };

  const pluginService = {
    getDefinition: vi.fn((name: string) =>
      name === "send_message" ? { type: FunctionType.Action } : { type: FunctionType.Tool },
    ),
    invoke: vi.fn(
      async (
        _name: string,
        _params: Record<string, unknown>,
        _ctx: ToolExecutionContext,
      ) => ({ success: true, status: "ok", content: "sent" }),
    ),
    executeRoundActions: vi.fn(
      async (
        actions: RoundActionCall[],
        execCtx: ToolExecutionContext,
      ): Promise<RoundActionExecutionResult> => {
        const toolResults = await Promise.all(
          actions.map(async (action, index) => {
            const params = action.params ?? {};
            const hookService = rootCtx["yesimbot.hook"] as
              | {
                  executeBefore: (
                    hookType: HookType,
                    input: Record<string, unknown>,
                    traceId: string,
                  ) => Promise<{ skipped: boolean; params: Record<string, unknown>; result?: unknown }>;
                  executeAfter: (
                    hookType: HookType,
                    input: Record<string, unknown>,
                    result: unknown,
                    traceId: string,
                  ) => Promise<void>;
                  executeError: (
                    hookType: HookType,
                    input: Record<string, unknown>,
                    error: Error,
                    traceId: string,
                  ) => Promise<void>;
                }
              | undefined;
            let nextParams = params;
            if (hookService) {
              const before = await hookService.executeBefore(HookType.Tool, nextParams, "test-trace");
              if (before.skipped) {
                return {
                  id: index,
                  name: action.name,
                  success: false,
                  status: "failed",
                  error: "hook skipped",
                };
              }
              nextParams = before.params;
            }
            const result = await pluginService.invoke(action.name, nextParams, execCtx);
            if (hookService) {
              await hookService.executeAfter(HookType.Tool, nextParams, result, "test-trace");
            }
            return {
              id: index,
              name: action.name,
              success: result.success,
              status: result.status,
              ...(result.success ? { result: result.content } : { error: "invoke failed" }),
            };
          }),
        );
        return {
          toolResults,
          hasToolCalls: toolResults.length > 0,
          hasActionCalls: actions.some(
            (action) => pluginService.getDefinition(action.name)?.type === FunctionType.Action,
          ),
        };
      },
    ),
    getTools: vi.fn(() => []),
  };

  rootCtx["yesimbot.horizon"] = horizonService;
  rootCtx["yesimbot.plugin"] = pluginService;
  rootCtx["yesimbot.prompt"] = promptService;
  rootCtx["yesimbot.model"] = modelService;
  rootCtx["yesimbot.skill"] = skillService;

  const loop = new ThinkActLoop(
    rootCtx as never,
    {
      model: "mock:model",
      maxRounds: 2,
      debugLevel: 0,
    } as never,
  );

  const percept: Percept = {
    id: "percept-1",
    traceId: isHeartbeat ? "trace-heartbeat-1" : "trace-user-1",
    type: isHeartbeat ? "internal" : "direct",
    platform: "discord",
    channelId: "channel-1",
    timestamp: new Date(),
    metadata: isHeartbeat ? { isHeartbeat: true, triggeredBy: "global" } : {},
  };

  const toolCtx: ToolExecutionContext = {
    platform: "discord",
    channelId: "channel-1",
    session: { send: vi.fn(async () => undefined) } as never,
    bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
  };

  return { loop, percept, toolCtx, compressor, horizonEvents, agentLogger };
}

describe("Hybrid compression runtime wiring", () => {
  it("calls maybeCompress once at teardown for normal user-triggered loop runs", async () => {
    const harness = createCompressionHarness({ isHeartbeat: false });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.compressor.maybeCompress).toHaveBeenCalledTimes(1);
    expect(harness.compressor.maybeCompress).toHaveBeenCalledWith({
      platform: "discord",
      channelId: "channel-1",
    });
    expect(harness.horizonEvents.markAsActive).toHaveBeenCalledTimes(1);
    expect(harness.horizonEvents.archiveStale).toHaveBeenCalledTimes(1);
    expect(harness.compressor.compress).not.toHaveBeenCalled();
  });

  it("calls maybeCompress once at teardown for heartbeat-triggered loop runs", async () => {
    const harness = createCompressionHarness({ isHeartbeat: true });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.compressor.maybeCompress).toHaveBeenCalledTimes(1);
    expect(harness.horizonEvents.markAsActive).toHaveBeenCalledTimes(1);
    expect(harness.horizonEvents.archiveStale).toHaveBeenCalledTimes(1);
    expect(harness.compressor.compress).not.toHaveBeenCalled();
  });

  it("degrades silently when maybeCompress rejects and still completes teardown", async () => {
    const harness = createCompressionHarness({
      maybeCompressImpl: async () => Promise.reject(new Error("compression unavailable")),
    });

    await expect(harness.loop.run(harness.percept, harness.toolCtx)).resolves.toEqual({
      totalTokens: expect.any(Number),
      totalToolCalls: expect.any(Number),
    });

    await Promise.resolve();

    expect(harness.compressor.maybeCompress).toHaveBeenCalledTimes(1);
    expect(harness.horizonEvents.markAsActive).toHaveBeenCalledTimes(1);
    expect(harness.horizonEvents.archiveStale).toHaveBeenCalledTimes(1);
    expect(harness.agentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Compression check failed (degraded):"),
      expect.any(Error),
    );
    expect(harness.compressor.compress).not.toHaveBeenCalled();
  });
});
