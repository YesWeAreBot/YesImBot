import { describe, expect, it, vi } from "vitest";

const {
  mockCreateSystemPromptExtension,
  mockApplyPresenterCatalogTo,
} = vi.hoisted(() => ({
  mockCreateSystemPromptExtension: vi.fn(),
  mockApplyPresenterCatalogTo: vi.fn(),
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
  HookRunner: class {
    clear() {}
    on() {}
  },
  SessionManager: class {},
  convertToLlm: vi.fn(),
}));

vi.mock("../../../src/internal/bot/bot.js", () => ({
  AthenaBot: class {
    present = vi.fn().mockResolvedValue(null);
    speak = vi.fn().mockResolvedValue({ ok: true, attemptedSegments: [], deliveredSegments: [], failedSegments: [], anomalies: [] });
    getSpeakElementPrompts = vi.fn().mockReturnValue([]);
  },
}));

vi.mock("../../../src/internal/bot/presentation.js", () => ({
  createPresenterCatalog: vi.fn().mockReturnValue({
    applyTo: mockApplyPresenterCatalogTo,
    registerBase: vi.fn(),
  }),
  createPresenterRegistry: vi.fn(),
}));

vi.mock("../../../src/internal/bot/speak.js", () => ({
  createSpeakElementRegistry: vi.fn().mockReturnValue({
    register: vi.fn(),
    getPromptElements: vi.fn().mockReturnValue([]),
    compile: vi.fn(),
  }),
}));

vi.mock("../../../src/services/extension/built-in/system-prompt.js", () => ({
  createSystemPromptExtension: mockCreateSystemPromptExtension,
}));

vi.mock("../../../src/internal/extension/context.js", () => ({
  createExtensionBinding: vi.fn(),
}));

vi.mock("../../../src/internal/extension/tools.js", () => ({
  buildToolSnapshotFromBindings: vi.fn().mockReturnValue({
    tools: new Map(),
    activeToolNames: [],
  }),
}));

vi.mock("../../../src/internal/runtime/helpers.js", () => ({
  buildAgentSessionConfig: vi.fn().mockReturnValue({}),
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
      registerExtension: vi.fn().mockResolvedValue(undefined),
      getAllDefinitions: vi.fn().mockReturnValue([]),
    },
    sessionStore: {
      getChannelSettingsPath: vi.fn().mockReturnValue("/tmp/athena-test/channel/settings.json"),
      getOrCreate: vi.fn().mockResolvedValue({
        buildSessionContext: vi.fn().mockReturnValue({ messages: [] }),
        appendCustomEntry: vi.fn(),
        appendCustomMessageEntry: vi.fn(),
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
      getPresenterCatalog: vi.fn().mockReturnValue({
        applyTo: mockApplyPresenterCatalogTo,
        registerBase: vi.fn(),
      }),
    },
    observedSubscribers,
    rotationSubscribers,
  };
}

describe("RuntimeController", () => {
  it("subscribes to Bot Module and creates channel session with object references", async () => {
    const deps = createDeps();
    mockCreateSystemPromptExtension.mockReturnValue({
      id: "yesimbot:system-prompt",
      setup: vi.fn(),
    });

    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig({
        allowedChannels: [{ platform: "onebot", channelId: "group-1", type: "group" }],
      }) as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      sessionStore: deps.sessionStore as never,
      botModule: deps.botModule as never,
    });

    await controller.start();

    const handleEvent = vi.spyOn(
      (controller as unknown as { channels: Map<string, { handleEvent: typeof vi.fn }> }).channels,
      "get",
    );

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
    });
    expect(deps.botModule.getPresenterCatalog).toHaveBeenCalled();
  });

  it("rebuilds a cached channel session when observed bot identity changes", async () => {
    const deps = createDeps();
    mockCreateSystemPromptExtension.mockReturnValue({
      id: "yesimbot:system-prompt",
      setup: vi.fn(),
    });

    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig() as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      sessionStore: deps.sessionStore as never,
      botModule: deps.botModule as never,
    });

    await controller.start();

    // First event with bot-1
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

    // Second event with bot-2 (different bot identity)
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

    // Should have created two different sessions (disposed first, recreated second)
    expect(deps.sessionStore.getOrCreate).toHaveBeenCalledTimes(2);
  });
});
