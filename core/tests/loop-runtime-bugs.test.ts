import { describe, expect, it, vi } from "vitest";

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { CorePlugin } from "../src/services/plugin/builtin/core";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";

type MockModelResponse = {
  text?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  textStream?: AsyncIterable<string>;
};

function createHarness(options?: {
  maxRounds?: number;
  streamMode?: boolean;
  modelResponses?: MockModelResponse[];
  useRealSendMessage?: boolean;
}) {
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const timelineOrder: string[] = [];
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn(),
  } as unknown as Record<string, unknown>;

  const horizonEventMocks = {
    recordAgentResponse: vi.fn(async () => {
      timelineOrder.push("agent.response");
      return undefined;
    }),
    recordMessage: vi.fn(async () => {
      timelineOrder.push("message");
      return undefined;
    }),
    recordAgentAction: vi.fn(async () => {
      timelineOrder.push("agent.action");
      return undefined;
    }),
  };

  const horizonService = {
    buildView: vi.fn(async () => ({
      self: { id: "bot-1", name: "Athena", role: "assistant" },
      entities: [],
      history: [],
    })),
    formatHorizonText: vi.fn(async () => [{ role: "user", content: "hello" }]),
    events: {
      recordAgentResponse: horizonEventMocks.recordAgentResponse,
      recordAgentAction: horizonEventMocks.recordAgentAction,
      recordMessage: horizonEventMocks.recordMessage,
      markAsActive: vi.fn(async () => undefined),
      archiveStale: vi.fn(async () => undefined),
    },
    config: {},
    compressor: undefined,
  };

  const pluginService = {
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
    getDefinition: vi.fn((name: string) =>
      name === "send_message" ? { type: FunctionType.Action } : { type: FunctionType.Tool },
    ),
    invoke: vi.fn(
      async (name: string, params: Record<string, unknown>, invokeCtx: ToolExecutionContext) => {
        if (name === "send_message" && options?.useRealSendMessage) {
          const corePlugin = new CorePlugin(rootCtx as never);
          return corePlugin.sendMessage(params as never, invokeCtx);
        }
        return { success: true, status: "ok", content: "sent" };
      },
    ),
    getTools: vi.fn(() => []),
    getCapabilityResolvers: vi.fn(() => []),
  };

  const promptService = {
    emitPromptBlocks: vi.fn(async () => ({
      sections: [],
      stableBlock: "",
      dynamicBlock: "",
      stableSignature: "sig",
    })),
    registerFragmentSource: vi.fn(() => () => undefined),
  };

  const defaultModelResponses = options?.streamMode
    ? [
        {
          text: undefined,
          usage: { inputTokens: 1, outputTokens: 1 },
          textStream: (async function* () {
            yield '{"actions":[';
            yield '{"name":"send_message","params":{"content":"streamed"}}]}';
          })(),
        },
      ]
    : [
        {
          text: '{"actions":[{"name":"lookup_tool","params":{"q":"status"}}]}',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        {
          text: '{"actions":[{"name":"send_message","params":{"content":"second-round"}}]}',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
  const modelResponses = options?.modelResponses ?? defaultModelResponses;
  let modelCallIndex = 0;

  const modelService = {
    getProvider: vi.fn(() => undefined),
    call: vi.fn(async (_model: string, _params: unknown, _fallback?: string[]) => {
      const value: MockModelResponse = modelResponses[modelCallIndex] ?? {
        text: "",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      modelCallIndex += 1;
      return value;
    }),
    streamCall: vi.fn(async (_model: string, _params: unknown, _fallback?: string[]) => {
      const value: MockModelResponse = modelResponses[modelCallIndex] ?? {
        text: "",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      modelCallIndex += 1;
      return value;
    }),
  };

  rootCtx["yesimbot.horizon"] = horizonService;
  rootCtx["yesimbot.plugin"] = pluginService;
  rootCtx["yesimbot.prompt"] = promptService;
  rootCtx["yesimbot.model"] = modelService;

  const loop = new ThinkActLoop(
    rootCtx as never,
    {
      model: "mock:model",
      maxRounds: options?.maxRounds ?? 2,
      streamMode: options?.streamMode ?? false,
      debugLevel: 0,
    } as never,
  );

  const percept: Percept = {
    id: "p-1",
    traceId: "trace-loop-1",
    type: "direct",
    platform: "discord",
    channelId: "c-1",
    timestamp: new Date(),
    metadata: {},
  };

  const toolCtx: ToolExecutionContext = {
    platform: "discord",
    channelId: "c-1",
    session: { send: vi.fn(async () => undefined) } as never,
    bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
  };

  return {
    loop,
    percept,
    toolCtx,
    modelService,
    timelineOrder,
    horizonEventMocks,
  };
}

describe("ThinkActLoop runtime bug fixes", () => {
  it("creates loop harness with required service stubs", () => {
    const harness = createHarness();
    expect(harness.modelService.call).toBeTypeOf("function");
    expect(harness.modelService.streamCall).toBeTypeOf("function");
    expect(harness.toolCtx.bot?.selfId).toBe("bot-1");
  });

  it("adds assistant output to messages history before the next tool-result turn", async () => {
    const harness = createHarness({ maxRounds: 2, streamMode: false });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.modelService.call).toHaveBeenCalledTimes(2);
    const secondCall = harness.modelService.call.mock.calls.at(1)?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistantMessages = secondCall.messages.filter((m) => m.role === "assistant");
    const firstRoundRaw = '{"actions":[{"name":"lookup_tool","params":{"q":"status"}}]}';
    expect(assistantMessages.filter((m) => m.content === firstRoundRaw)).toHaveLength(1);
  });

  it("uses modelService.streamCall when streamMode is true and avoids modelService.call", async () => {
    const harness = createHarness({ maxRounds: 1, streamMode: true });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.modelService.streamCall).toHaveBeenCalledTimes(1);
    expect(harness.modelService.call).not.toHaveBeenCalled();
  });

  it("records agent.response before send_message timeline writes and agent.action after tool execution", async () => {
    const harness = createHarness({
      maxRounds: 1,
      useRealSendMessage: true,
      modelResponses: [
        {
          text: '{"actions":[{"name":"send_message","params":{"content":"ordered"}}]}',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.timelineOrder).toEqual(["agent.response", "message", "agent.action"]);
  });

  it("carries assistant rawText from every completed round into the next model call exactly once", async () => {
    const round1Raw = '{"actions":[{"name":"lookup_tool","params":{"q":"one"}}]}';
    const round2Raw = '{"actions":[{"name":"lookup_tool","params":{"q":"two"}}]}';
    const round3Raw = '{"actions":[{"name":"send_message","params":{"content":"done"}}]}';

    const harness = createHarness({
      maxRounds: 3,
      modelResponses: [
        { text: round1Raw, usage: { inputTokens: 1, outputTokens: 1 } },
        { text: round2Raw, usage: { inputTokens: 1, outputTokens: 1 } },
        { text: round3Raw, usage: { inputTokens: 1, outputTokens: 1 } },
      ],
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.modelService.call).toHaveBeenCalledTimes(3);
    const thirdCall = harness.modelService.call.mock.calls.at(2)?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistantMessages = thirdCall.messages.filter((m) => m.role === "assistant");

    expect(assistantMessages.filter((m) => m.content === round1Raw)).toHaveLength(1);
    expect(assistantMessages.filter((m) => m.content === round2Raw)).toHaveLength(1);
  });
});
