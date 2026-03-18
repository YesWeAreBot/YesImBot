import { describe, expect, it, vi } from "vitest";

import type { Percept } from "../src/runtime/contracts";
import { ThinkActLoop } from "../src/services/agent/loop";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";

function createHarness(options: {
  responses: string[];
  isHeartbeat?: boolean;
  maxRounds?: number;
  invokeImpl?: (name: string) => Promise<{ success: boolean; status: string; content?: string }>;
}) {
  const { responses, isHeartbeat = true, maxRounds = 2, invokeImpl } = options;
  const agentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), level: 0 };
  const rootCtx = {
    baseDir: "/tmp",
    logger: vi.fn(() => agentLogger),
    on: vi.fn(),
  } as unknown as Record<string, unknown>;

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
    analyze: vi.fn(async () => [{ dimension: "scene", value: "group-chat", confidence: 0.95 }]),
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
      const text = responses[modelCalls];
      modelCalls += 1;
      if (typeof text === "string") {
        return {
          text,
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
      async (name: string) =>
        invokeImpl?.(name) ?? {
          success: true,
          status: "ok",
          content: name === "send_message" ? "sent" : "tool-ok",
        },
    ),
    getTools: vi.fn(() => []),
  };

  const arousalService = {
    recordProactiveMessage: vi.fn(),
  };

  rootCtx["yesimbot.horizon"] = horizonService;
  rootCtx["yesimbot.plugin"] = pluginService;
  rootCtx["yesimbot.prompt"] = promptService;
  rootCtx["yesimbot.model"] = modelService;
  rootCtx["yesimbot.trait"] = traitService;
  rootCtx["yesimbot.skill"] = skillService;
  rootCtx["yesimbot.arousal"] = arousalService;

  const loop = new ThinkActLoop(
    rootCtx as never,
    {
      model: "mock:model",
      maxRounds,
      debugLevel: 0,
    } as never,
  );

  const percept: Percept = {
    id: "p-1",
    traceId: "trace-proactive-1",
    type: "direct",
    platform: "discord",
    channelId: "c-1",
    timestamp: new Date(),
    metadata: isHeartbeat ? { isHeartbeat: true } : {},
  };

  const toolCtx: ToolExecutionContext = {
    platform: "discord",
    channelId: "c-1",
    session: { send: vi.fn(async () => undefined) } as never,
    bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
  };

  return { loop, percept, toolCtx, arousalService, agentLogger };
}

describe("proactive rate-limit accounting", () => {
  it("records proactive quota for successful heartbeat send_message", async () => {
    const harness = createHarness({
      responses: ['{"actions":[{"name":"send_message","params":{"content":"hello"}}]}'],
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledTimes(1);
    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledWith("discord:c-1");
  });

  it("does not record proactive quota when heartbeat send_message fails", async () => {
    const harness = createHarness({
      responses: ['{"actions":[{"name":"send_message","params":{"content":"hello"}}]}'],
      invokeImpl: async (name) =>
        name === "send_message"
          ? { success: false, status: "failed", content: "send-failed" }
          : { success: true, status: "ok" },
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.arousalService.recordProactiveMessage).not.toHaveBeenCalled();
  });

  it("charges proactive quota to explicit target channel override", async () => {
    const harness = createHarness({
      responses: [
        '{"actions":[{"name":"send_message","params":{"content":"hello","target":{"platform":"discord","channelId":"c-2"}}}]}',
      ],
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledTimes(1);
    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledWith("discord:c-2");
  });

  it("records proactive quota at most once per heartbeat run across normal and wrap-up sends", async () => {
    const harness = createHarness({
      maxRounds: 1,
      responses: [
        '{"actions":[{"name":"lookup_tool","params":{"q":"status"}},{"name":"send_message","params":{"content":"round-1"}}],"request_heartbeat":false}',
        '{"actions":[{"name":"send_message","params":{"content":"wrap-up"}}]}',
      ],
    });

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledTimes(1);
    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledWith("discord:c-1");
    expect(harness.agentLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("proactive_quota_already_recorded"),
    );
  });
});
