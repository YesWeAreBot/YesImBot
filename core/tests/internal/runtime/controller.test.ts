import { describe, expect, it, vi } from "vitest";

const {
  mockCreatePresenterRegistry,
  mockCreateSpeakElementRegistry,
  mockCreateSystemPromptExtension,
  mockCreateChannelRuntime,
  mockBuildAgentSessionConfig,
  mockApplyPresentersTo,
} = vi.hoisted(() => ({
  mockCreatePresenterRegistry: vi.fn(),
  mockCreateSpeakElementRegistry: vi.fn(),
  mockCreateSystemPromptExtension: vi.fn(),
  mockCreateChannelRuntime: vi.fn(),
  mockBuildAgentSessionConfig: vi.fn().mockReturnValue({}),
  mockApplyPresentersTo: vi.fn(),
}));

vi.mock("@yesimbot/agent/agent", () => ({
  Agent: class {
    signal = new AbortController().signal;
    state = { model: {}, isStreaming: false, systemPrompt: "" };

    hasQueuedMessages() {
      return false;
    }

    abort() {}
  },
}));

vi.mock("@yesimbot/agent/session", () => ({
  AgentSession: class {
    subscribe = vi.fn().mockReturnValue(vi.fn());
    sendCustomMessage = vi.fn().mockResolvedValue(undefined);
    sendUserMessage = vi.fn().mockResolvedValue(undefined);
    applyToolState = vi.fn();
    getActiveToolNames = vi.fn().mockReturnValue([]);
    setActiveToolsByName = vi.fn();
    getContextUsage = vi.fn().mockReturnValue({});
    compact = vi.fn();
    dispose = vi.fn();
  },
  HookRunner: class {},
  SessionManager: class {},
  convertToLlm: vi.fn(),
}));

vi.mock("../../../src/internal/bot/bot.js", () => ({
  AthenaBot: class {
    getSpeakElementPrompts = vi.fn().mockReturnValue([]);
  },
}));

vi.mock("../../../src/internal/bot/presentation.js", () => ({
  createPresenterRegistry: mockCreatePresenterRegistry,
}));

vi.mock("../../../src/internal/bot/speak.js", () => ({
  createSpeakElementRegistry: mockCreateSpeakElementRegistry,
}));

vi.mock("../../../src/extension/built-in/system-prompt.js", () => ({
  createSystemPromptExtension: mockCreateSystemPromptExtension,
}));

vi.mock("../../../src/internal/runtime/channel.js", () => ({
  createChannelRuntime: mockCreateChannelRuntime,
}));

vi.mock("../../../src/internal/runtime/helpers.js", () => ({
  buildAgentSessionConfig: mockBuildAgentSessionConfig,
}));

vi.mock("../../../src/internal/runtime/settings.js", () => ({
  RuntimeSettingsManager: class {
    settings = { delivery: {} };
  },
}));

vi.mock("../../../src/internal/runtime/behavior.js", () => ({
  WillingnessManager: class {
    shouldReply() {
      return { decision: false, probability: 0 };
    }
  },
}));

import { RuntimeController } from "../../../src/internal/runtime/controller.js";

function createConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    basePath: "/tmp/athena-test",
    chatModel: "test-model",
    allowedChannels: [],
    logLevel: 2,
    base: { text: 12 },
    attribute: { atMention: 100, isQuote: 15, isDirectMessage: 40 },
    interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
    lifecycle: {
      maxWillingness: 100,
      decayHalfLifeSeconds: 600,
      probabilityThreshold: 55,
      probabilityAmplifier: 0.04,
      replyCost: 35,
    },
    ...overrides,
  };
}

function createDeps() {
  const observedSubscribers: Array<(observed: unknown) => Promise<void>> = [];
  const rotationSubscribers: Array<(event: unknown) => Promise<void>> = [];
  const logger = { level: 2, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    command: vi.fn().mockReturnValue({ action: vi.fn() }),
    logger: vi.fn().mockReturnValue(logger),
    on: vi.fn().mockReturnValue(vi.fn()),
  };
  return {
    ctx,
    modelService: { resolveChatModel: vi.fn().mockReturnValue({ model: {} }) },
    extensionRegistry: {
      registerExtension: vi.fn().mockResolvedValue({
        totalChannels: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
        allSucceeded: true,
      }),
      getAllDefinitions: vi.fn().mockReturnValue([]),
    },
    extensionRuntimeManager: {
      createChannelRuntime: vi.fn().mockResolvedValue(undefined),
      disposeChannelRuntime: vi.fn().mockResolvedValue(undefined),
      getPromptToolContext: vi.fn().mockReturnValue({
        selectedTools: [],
        toolSnippets: {},
        promptGuidelines: [],
      }),
      getPromptSpeakElementContext: vi.fn().mockReturnValue({ elements: [] }),
    },
    sessionStore: {
      getChannelSettingsPath: vi.fn().mockReturnValue("/tmp/athena-test/channel/settings.json"),
      getOrCreate: vi.fn().mockResolvedValue({
        buildSessionContext: vi.fn().mockReturnValue({ messages: [] }),
        appendCustomEntry: vi.fn(),
        appendSessionInfo: vi.fn(),
        getSessionName: vi.fn(),
      }),
      subscribeSessionRotated: vi.fn((subscriber) => {
        rotationSubscribers.push(subscriber);
        return vi.fn();
      }),
    },
    botModule: {
      subscribeObservedEvents: vi.fn((subscriber) => {
        observedSubscribers.push(subscriber);
        return vi.fn();
      }),
      applyPresentersTo: mockApplyPresentersTo,
    },
    observedSubscribers,
    rotationSubscribers,
  };
}

describe("RuntimeController", () => {
  it("subscribes to Bot Module and creates channel runtime with object references", async () => {
    const deps = createDeps();
    const handleEvent = vi.fn().mockResolvedValue(undefined);
    mockCreatePresenterRegistry.mockReturnValue({ registerBase: vi.fn() });
    mockCreateSpeakElementRegistry.mockReturnValue({ register: vi.fn() });
    mockCreateSystemPromptExtension.mockReturnValue({
      id: "yesimbot:system-prompt",
      setup: vi.fn(),
    });
    mockCreateChannelRuntime.mockReturnValue({ handleEvent, dispose: vi.fn() });

    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig({
        allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      }) as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      extensionRuntimeManager: deps.extensionRuntimeManager as never,
      sessionStore: deps.sessionStore as never,
      botModule: deps.botModule as never,
    });

    await controller.start();
    await deps.observedSubscribers[0]({
      event: {
        id: "event-1",
        kind: "chat_message",
        timestamp: 1,
        source: {
          platform: "onebot",
          channelId: "group-1",
          conversationType: "group",
          selfId: "bot-2",
        },
        actor: { id: "user-1" },
        payload: { messageId: "m-1", content: "hello" },
        metadata: { persist: true, triggerCandidate: true },
      },
      bot: { selfId: "bot-2", platform: "onebot", user: { name: "Athena" } },
      originSession: { id: "session-1" },
    });

    expect(deps.sessionStore.getOrCreate).toHaveBeenCalledWith({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      assignee: "bot-2",
    });
    expect(deps.extensionRuntimeManager.createChannelRuntime).toHaveBeenCalledTimes(1);
    expect(mockApplyPresentersTo).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "event-1" }), {
      originSession: { id: "session-1" },
    });
  });

  it("rebuilds a cached channel context when observed bot identity changes", async () => {
    const deps = createDeps();
    const runtimeA = { handleEvent: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
    const runtimeB = { handleEvent: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
    mockCreatePresenterRegistry.mockReturnValue({ registerBase: vi.fn() });
    mockCreateSpeakElementRegistry.mockReturnValue({ register: vi.fn() });
    mockCreateSystemPromptExtension.mockReturnValue({
      id: "yesimbot:system-prompt",
      setup: vi.fn(),
    });
    mockCreateChannelRuntime.mockReturnValueOnce(runtimeA).mockReturnValueOnce(runtimeB);

    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig() as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      extensionRuntimeManager: deps.extensionRuntimeManager as never,
      sessionStore: deps.sessionStore as never,
      botModule: deps.botModule as never,
    });

    await controller.start();
    await deps.observedSubscribers[0]({
      event: {
        id: "event-1",
        kind: "chat_message",
        timestamp: 1,
        source: {
          platform: "onebot",
          channelId: "group-1",
          conversationType: "group",
          selfId: "bot-1",
        },
        actor: { id: "user-1" },
        payload: { messageId: "m-1", content: "hello" },
        metadata: { persist: true, triggerCandidate: true },
      },
      bot: { selfId: "bot-1", platform: "onebot", user: { name: "Athena A" } },
    });
    await deps.observedSubscribers[0]({
      event: {
        id: "event-2",
        kind: "chat_message",
        timestamp: 2,
        source: {
          platform: "onebot",
          channelId: "group-1",
          conversationType: "group",
          selfId: "bot-2",
        },
        actor: { id: "user-2" },
        payload: { messageId: "m-2", content: "hello again" },
        metadata: { persist: true, triggerCandidate: true },
      },
      bot: { selfId: "bot-2", platform: "onebot", user: { name: "Athena B" } },
    });

    expect(runtimeA.dispose).toHaveBeenCalledTimes(1);
    expect(deps.extensionRuntimeManager.disposeChannelRuntime).toHaveBeenCalledWith({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });
    expect(runtimeB.handleEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "event-2" }), {
      originSession: undefined,
    });
  });
});
