import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildToolAssemblyMock,
  prepareRuntimeModelMock,
  toolLoopAgentCtorMock,
  generateMock,
  streamMock,
  toolLoopAgentInstances,
} = vi.hoisted(() => ({
  buildToolAssemblyMock: vi.fn(),
  prepareRuntimeModelMock: vi.fn(),
  toolLoopAgentCtorMock: vi.fn(),
  generateMock: vi.fn(),
  streamMock: vi.fn(),
  toolLoopAgentInstances: [] as Array<{ tools: ToolSet; settings: Record<string, unknown> }>,
}));

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly settings: Record<string, unknown>;
    readonly tools: ToolSet;

    constructor(settings: Record<string, unknown>) {
      this.settings = settings;
      this.tools = (settings.tools as ToolSet | undefined) ?? {};
      toolLoopAgentCtorMock(settings);
      toolLoopAgentInstances.push({ tools: this.tools, settings });
    }

    async generate(input: Record<string, unknown>): Promise<unknown> {
      return generateMock({
        input,
        settings: this.settings,
        tools: this.tools,
      });
    }

    async stream(input: Record<string, unknown>): Promise<unknown> {
      return streamMock({
        input,
        settings: this.settings,
        tools: this.tools,
      });
    }
  }

  return {
    ToolLoopAgent,
    stepCountIs: (n: number) => n,
  };
});

vi.mock("../../src/services/session/runtime/tool-assembly", () => ({
  buildToolAssembly: buildToolAssemblyMock,
}));

vi.mock("../../src/services/session/runtime/model-adapter", () => ({
  prepareRuntimeModel: prepareRuntimeModelMock,
}));

import { AgentSession } from "../../src/services/session/agent-session";
import { ChannelRuntime } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent, ResponseStatusRecord } from "../../src/services/session/types";
import { createTestSettingsManager } from "./test-settings-manager";

function createLanguageModel(label: string): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test-provider",
    modelId: label,
    defaultObjectGenerationMode: "json",
    supportsImageUrls: false,
    supportsUrl: () => false,
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModelV3;
}

function createLoggerMock() {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createContextMock() {
  return {
    logger: vi.fn(() => createLoggerMock()),
    "yesimbot.model": {
      resolve: vi.fn(() => ({ provider: "legacy", modelId: "legacy:model" })),
      resolveRegistration: vi.fn(),
    },
    "yesimbot.plugin": {
      getToolSet: vi.fn(() => ({})),
      getToolDefinitions: vi.fn(() => []),
    },
  };
}

function createBotMock(selfId = "bot-self") {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createEvent(overrides: Partial<ChannelEvent> = {}): ChannelEvent {
  return {
    platform: "discord",
    channelId: "channel-1",
    userId: "user-1",
    username: "alice",
    content: "@bot hello",
    isDirect: true,
    atSelf: false,
    isReplyToBot: false,
    messageId: `msg-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    elements: [],
    ...overrides,
  };
}

function createRuntime() {
  const ctx = createContextMock();
  const bot = createBotMock();
  const sessionManager = SessionManager.inMemory("discord:channel-1");
  const runtime = new ChannelRuntime(ctx as never, {
    bot: bot as never,
    sessionManager,
    settingsManager: createTestSettingsManager({
      tools: {
        enabled: ["search_docs"],
      },
    }),
    platform: "discord",
    channelId: "channel-1",
    basePath: "/tmp/athena-runtime-integration",
  });

  return { ctx, bot, sessionManager, runtime };
}

function createTool(name: string, execute?: ReturnType<typeof vi.fn>) {
  return {
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    execute: execute ?? vi.fn(async () => name),
  };
}

function listResponseStatusNotices(sessionManager: SessionManager) {
  return sessionManager.getTimeline().filter((record) => {
    return (
      record.kind === "system_notice" &&
      record.materializationKey === "response_status" &&
      record.subType.startsWith("response_status_")
    );
  });
}

function findLatestResponseStatusNotice(sessionManager: SessionManager) {
  const records = listResponseStatusNotices(sessionManager);
  return records[records.length - 1];
}

async function runPrepareHooks(payload: {
  input: Record<string, unknown>;
  settings: Record<string, unknown>;
  tools: ToolSet;
}): Promise<{
  prepareCallResult: Record<string, unknown>;
  prepareStepResult: Record<string, unknown>;
}> {
  const prepareCall = payload.settings.prepareCall as
    | ((
        options: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>)
    | undefined;
  const prepareStep = payload.settings.prepareStep as
    | ((
        options: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>)
    | undefined;

  const prepareCallResult =
    (await prepareCall?.({
      ...payload.input,
      ...payload.settings,
    })) ?? {};
  const prepareStepResult =
    (await prepareStep?.({
      steps: [],
      stepNumber: 0,
      model: prepareCallResult.model ?? payload.settings.model,
      messages: prepareCallResult.messages ?? payload.input.messages,
      experimental_context: prepareCallResult.experimental_context,
    })) ?? {};

  const activeTools = (prepareStepResult.activeTools as string[] | undefined) ?? [];
  const firstToolName =
    activeTools.find((toolName) => toolName !== "send_message" && toolName in payload.tools) ??
    activeTools.find((toolName) => toolName in payload.tools);
  if (firstToolName) {
    const tool = payload.tools[firstToolName] as {
      execute?: (...args: unknown[]) => Promise<unknown>;
    };
    await tool.execute?.(
      {},
      {
        toolCallId: `call-${firstToolName}`,
        experimental_context:
          prepareStepResult.experimental_context ?? prepareCallResult.experimental_context,
      },
    );
  }

  return {
    prepareCallResult,
    prepareStepResult,
  };
}

describe("ChannelRuntime integration seams", () => {
  beforeEach(() => {
    buildToolAssemblyMock.mockReset();
    prepareRuntimeModelMock.mockReset();
    toolLoopAgentCtorMock.mockClear();
    generateMock.mockReset();
    streamMock.mockReset();
    toolLoopAgentInstances.length = 0;
  });

  it("keeps supported tools stable while only activeTools change per turn", async () => {
    const { ctx, runtime } = createRuntime();
    const sendMessageTool = createTool("send_message");
    const firstSearchTool = createTool("search_docs");
    const secondSearchTool = createTool("search_docs-second");
    const firstSupportedTools = {
      send_message: sendMessageTool,
      search_docs: firstSearchTool,
    } satisfies ToolSet;
    const secondSupportedTools = {
      send_message: sendMessageTool,
      search_docs: secondSearchTool,
    } satisfies ToolSet;
    const prepareStepActiveTools: string[][] = [];

    buildToolAssemblyMock
      .mockResolvedValueOnce({
        supportedTools: firstSupportedTools,
        activeTools: { send_message: sendMessageTool },
        experimentalContext: { search: { turn: 1 } },
        signature: "stable-supported-tools",
      })
      .mockResolvedValueOnce({
        supportedTools: secondSupportedTools,
        activeTools: {
          send_message: sendMessageTool,
          search_docs: secondSearchTool,
        },
        experimentalContext: { search: { turn: 2 } },
        signature: "stable-supported-tools",
      });

    prepareRuntimeModelMock.mockImplementation(({ modelId }: { modelId: string }) => ({
      fullId: modelId,
      providerId: "test-provider",
      modelId: "test-model",
      entry: {
        id: "test-model",
        toolCall: true,
        reasoning: false,
      },
      model: createLanguageModel(`wrapped:${modelId}`),
    }));

    generateMock.mockImplementation(async (payload) => {
      const { prepareStepResult } = await runPrepareHooks(payload as never);
      prepareStepActiveTools.push((prepareStepResult.activeTools as string[] | undefined) ?? []);
    });

    await runtime.receive(createEvent({ messageId: "msg-stable-1" }));
    await vi.waitFor(() => {
      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
      expect(generateMock).toHaveBeenCalledTimes(1);
      expect(runtime.getResponseState()).toBe("idle");
    });

    const firstAgentTools = toolLoopAgentInstances[0]?.tools;
    expect(firstAgentTools).toBeTruthy();
    expect(firstAgentTools?.search_docs).toBe(firstSearchTool);

    await runtime.receive(createEvent({ messageId: "msg-stable-2" }));
    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(2);
      expect(runtime.getResponseState()).toBe("idle");
    });

    expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
    expect(buildToolAssemblyMock).toHaveBeenCalledTimes(2);
    expect(prepareRuntimeModelMock).toHaveBeenCalledTimes(1);
    expect(ctx["yesimbot.model"].resolve).not.toHaveBeenCalled();
    expect(prepareStepActiveTools).toEqual([["send_message"], ["send_message", "search_docs"]]);
    expect(toolLoopAgentInstances[0]?.tools.search_docs).toBe(firstSearchTool);
  });

  it("pipes plugin-owned extension context through prepareCall and prepareStep experimental_context", async () => {
    const { runtime } = createRuntime();
    const experimentalContext = {
      search: {
        requestId: "ctx-1",
        allow: true,
      },
    };
    const observedToolContexts: unknown[] = [];
    const observedPrepareCallContexts: unknown[] = [];
    const observedPrepareStepContexts: unknown[] = [];

    buildToolAssemblyMock.mockResolvedValue({
      supportedTools: {
        send_message: createTool("send_message"),
        search_docs: createTool(
          "search_docs",
          vi.fn(async (_input, options: { experimental_context?: unknown }) => {
            observedToolContexts.push(options.experimental_context);
            return "ok";
          }),
        ),
      },
      activeTools: {
        send_message: createTool("send_message"),
        search_docs: createTool(
          "search_docs-active",
          vi.fn(async (_input, options: { experimental_context?: unknown }) => {
            observedToolContexts.push(options.experimental_context);
            return "ok";
          }),
        ),
      },
      experimentalContext,
      signature: "context-tools",
    });

    prepareRuntimeModelMock.mockReturnValue({
      fullId: "test:model",
      providerId: "test-provider",
      modelId: "test-model",
      entry: {
        id: "test-model",
        toolCall: true,
        reasoning: false,
      },
      model: createLanguageModel("with-context"),
    });

    generateMock.mockImplementation(async (payload) => {
      const { prepareCallResult, prepareStepResult } = await runPrepareHooks(payload as never);
      observedPrepareCallContexts.push(prepareCallResult.experimental_context);
      observedPrepareStepContexts.push(prepareStepResult.experimental_context);
    });

    await runtime.receive(createEvent({ messageId: "msg-experimental-context" }));

    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(1);
      expect(runtime.getResponseState()).toBe("idle");
    });

    expect(observedPrepareCallContexts).toEqual([experimentalContext]);
    expect(observedPrepareStepContexts).toEqual([experimentalContext]);
    expect(observedToolContexts).toEqual([experimentalContext]);
  });

  it.each([
    ["invalid model resolution", "model_not_found", /model_not_found/],
    ["missing required tool", "tools.required missing active tool: search_docs", /search_docs/],
    [
      "assembly conflict",
      "Duplicate explicit tool name: search_docs",
      /Duplicate explicit tool name/,
    ],
  ])(
    "funnels %s through hidden response_status fail boundary without new recovery paths",
    async (_label, errorMessage, matcher) => {
      const { sessionManager, runtime } = createRuntime();

      if (errorMessage === "model_not_found") {
        buildToolAssemblyMock.mockResolvedValue({
          supportedTools: {
            send_message: createTool("send_message"),
          },
          activeTools: {
            send_message: createTool("send_message"),
          },
          experimentalContext: {},
          signature: "model-error",
        });
        prepareRuntimeModelMock.mockImplementation(() => {
          throw new Error("model_not_found");
        });
      } else {
        buildToolAssemblyMock.mockImplementation(() => {
          throw new Error(errorMessage);
        });
      }

      await runtime.receive(createEvent({ messageId: `msg-${errorMessage}` }));

      await vi.waitFor(() => {
        expect(runtime.getResponseState()).toBe("idle");
      });

      expect(generateMock).not.toHaveBeenCalled();
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        const data = responseStatus.data as ResponseStatusRecord;
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.visibility).toBe("hidden");
        expect(responseStatus.materialization).toBe("hidden");
        expect(data.endReason).toBe("exception");
        expect(data.nextAction).toBe("blocked");
        expect(data.blockedReason).toMatch(matcher);
      }

      const session = new AgentSession(sessionManager);
      expect(
        session.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }),
      ).toBe(false);
    },
  );
});
