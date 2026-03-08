import { describe, expect, it, vi } from "vitest";

import { ThinkActLoop } from "../src/services/agent/loop";
import { FunctionType, type ToolExecutionContext } from "../src/services/plugin/types";
import type { Percept } from "../src/services/shared/types";

function createHarness(actionPayload: string, isHeartbeat = true) {
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

  const pluginService = {
    getDefinition: vi.fn((name: string) =>
      name === "send_message" ? { type: FunctionType.Action } : { type: FunctionType.Tool },
    ),
    invoke: vi.fn(async () => ({ success: true, status: "ok", content: "sent" })),
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

  const loop = new ThinkActLoop(rootCtx as never, {
    model: "mock:model",
    maxRounds: 2,
    debugLevel: 0,
  } as never);

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

  return { loop, percept, toolCtx, arousalService };
}

describe("proactive rate-limit accounting", () => {
  it("records proactive quota for successful heartbeat send_message", async () => {
    const harness = createHarness('{"actions":[{"name":"send_message","params":{"content":"hello"}}]}');

    await harness.loop.run(harness.percept, harness.toolCtx);

    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledTimes(1);
    expect(harness.arousalService.recordProactiveMessage).toHaveBeenCalledWith("discord:c-1");
  });
});
