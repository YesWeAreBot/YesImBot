import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  compileToolsMock,
  buildResponseContextMock,
  selectToolsMock,
  prepareRuntimeModelMock,
  toolLoopAgentCtorMock,
  generateMock,
  streamMock,
  toolLoopAgentInstances,
} = vi.hoisted(() => ({
  compileToolsMock: vi.fn(),
  buildResponseContextMock: vi.fn(),
  selectToolsMock: vi.fn(),
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

vi.mock("../../src/services/session/runtime/model-adapter", () => ({
  prepareRuntimeModel: prepareRuntimeModelMock,
}));

import { AgentSession } from "../../src/services/session/agent-session";
import { ChannelRuntime } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";
import type {
  ChannelMessageInput,
  ResponseStatusRecord,
} from "../../src/services/session/types/index";
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
      compileTools: compileToolsMock,
      buildResponseContext: buildResponseContextMock,
      selectTools: selectToolsMock,
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

function createChannelMessageInput(
  overrides: Partial<ChannelMessageInput> = {},
): ChannelMessageInput {
  return {
    kind: "channel_message",
    platform: "discord",
    channelId: "channel-1",
    sender: {
      userId: "user-1",
      username: "alice",
    },
    content: "@bot hello",
    isDirect: true,
    atSelf: false,
    isReplyToBot: false,
    messageId: `msg-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
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
    compileToolsMock.mockReset();
    buildResponseContextMock.mockReset();
    selectToolsMock.mockReset();
    buildResponseContextMock.mockResolvedValue({});
    selectToolsMock.mockImplementation(
      async (request: {
        runtime?: unknown;
        scope?: string;
        catalog: { tools: ToolSet };
        responseContext?: unknown;
      }) => {
        const activeTools = request.catalog.tools;
        return {
          activeTools,
          activeToolNames: Object.keys(activeTools),
          responseContext: request.responseContext ?? {},
        };
      },
    );
    prepareRuntimeModelMock.mockReset();
    prepareRuntimeModelMock.mockReturnValue({
      fullId: "test:model",
      providerId: "test-provider",
      modelId: "test-model",
      entry: {
        id: "test-model",
        toolCall: true,
        reasoning: false,
      },
      model: createLanguageModel("default"),
    });
    toolLoopAgentCtorMock.mockClear();
    generateMock.mockReset();
    streamMock.mockReset();
    toolLoopAgentInstances.length = 0;
  });

  it("keeps supported tools stable while only activeTools change per turn", async () => {
    const { ctx, runtime } = createRuntime();
    const sendMessageTool = createTool("send_message");
    const firstSearchTool = createTool("search_docs");
    const supportedTools = {
      send_message: sendMessageTool,
      search_docs: firstSearchTool,
    } satisfies ToolSet;
    const prepareStepActiveTools: string[][] = [];

    compileToolsMock.mockResolvedValue({
      tools: supportedTools,
      handles: {},
      signature: "stable-supported-tools",
    });
    buildResponseContextMock
      .mockResolvedValueOnce({
        search: { turn: 1 },
      })
      .mockResolvedValueOnce({
        search: { turn: 2 },
      });
    selectToolsMock
      .mockResolvedValueOnce({
        activeTools: { send_message: sendMessageTool },
        activeToolNames: ["send_message"],
        responseContext: { search: { turn: 1 } },
      })
      .mockResolvedValueOnce({
        activeTools: {
          send_message: sendMessageTool,
          search_docs: firstSearchTool,
        },
        activeToolNames: ["send_message", "search_docs"],
        responseContext: { search: { turn: 2 } },
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

    await runtime.receive(createChannelMessageInput({ messageId: "msg-stable-1" }));
    await vi.waitFor(() => {
      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
      expect(generateMock).toHaveBeenCalledTimes(1);
      expect(runtime.getResponseState()).toBe("idle");
    });

    const firstAgentTools = toolLoopAgentInstances[0]?.tools;
    expect(firstAgentTools).toBeTruthy();
    expect(firstAgentTools?.search_docs).toBe(firstSearchTool);

    await runtime.receive(createChannelMessageInput({ messageId: "msg-stable-2" }));
    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(2);
      expect(runtime.getResponseState()).toBe("idle");
    });

    expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
    expect(compileToolsMock).toHaveBeenCalledTimes(1);
    expect(buildResponseContextMock).toHaveBeenCalledTimes(2);
    expect(selectToolsMock).toHaveBeenCalledTimes(2);
    expect(prepareRuntimeModelMock).toHaveBeenCalledTimes(1);
    expect(ctx["yesimbot.model"].resolve).not.toHaveBeenCalled();
    expect(prepareStepActiveTools).toEqual([["send_message"], ["send_message", "search_docs"]]);
    expect(toolLoopAgentInstances[0]?.tools.search_docs).toBe(firstSearchTool);

    const firstRequest = compileToolsMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstRequest).toMatchObject({
      hostInput: expect.objectContaining({
        channelId: "channel-1",
        platform: "discord",
        triggerEvents: expect.arrayContaining([
          expect.objectContaining({ messageId: "msg-stable-1" }),
        ]),
      }),
      scope: "discord:channel-1",
    });
    expect(firstRequest.runtime).toMatchObject({
      channelKey: "discord:channel-1",
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      turn: expect.objectContaining({
        messageId: "msg-stable-1",
        isDirect: true,
        atSelf: false,
        isReplyToBot: false,
      }),
    });
    expect(firstRequest.sendMessageTool).toEqual(
      expect.objectContaining({
        description: expect.any(String),
        inputSchema: expect.any(Object),
        execute: expect.any(Function),
      }),
    );

    const firstSelectRequest = selectToolsMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstSelectRequest).toMatchObject({
      toolSettings: { enabled: ["search_docs"] },
      responseContext: { search: { turn: 1 } },
    });
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

    const sendMessageTool = createTool("send_message");
    const searchTool = createTool(
      "search_docs",
      vi.fn(async (_input, options: { experimental_context?: unknown }) => {
        observedToolContexts.push(options.experimental_context);
        return "ok";
      }),
    );

    compileToolsMock.mockResolvedValue({
      tools: {
        send_message: sendMessageTool,
        search_docs: searchTool,
      },
      handles: {},
      signature: "context-tools",
    });
    buildResponseContextMock.mockResolvedValue(experimentalContext);
    selectToolsMock.mockResolvedValue({
      activeTools: {
        send_message: sendMessageTool,
        search_docs: searchTool,
      },
      activeToolNames: ["send_message", "search_docs"],
      responseContext: experimentalContext,
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

    await runtime.receive(createChannelMessageInput({ messageId: "msg-experimental-context" }));

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
        compileToolsMock.mockResolvedValue({
          tools: {
            send_message: createTool("send_message"),
          },
          handles: {},
          signature: "model-error",
        });
        prepareRuntimeModelMock.mockImplementation(() => {
          throw new Error("model_not_found");
        });
      } else {
        compileToolsMock.mockImplementation(() => {
          throw new Error(errorMessage);
        });
      }

      await runtime.receive(createChannelMessageInput({ messageId: `msg-${errorMessage}` }));

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
