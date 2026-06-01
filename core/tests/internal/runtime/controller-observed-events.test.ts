import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => ({
  Bot: class {},
  Context: class {},
  Eval: class {},
  Logger: class {},
  Schema: {
    object: (value: unknown) => ({ dict: value }),
    number: () => ({
      default() {
        return this;
      },
      min() {
        return this;
      },
      max() {
        return this;
      },
      description() {
        return this;
      },
    }),
    array: () => ({
      default() {
        return this;
      },
      role() {
        return this;
      },
      description() {
        return this;
      },
    }),
    string: () => ({
      default() {
        return this;
      },
      description() {
        return this;
      },
    }),
  },
  Session: class {},
  h: Object.assign(
    () => ({
      toString() {
        return "";
      },
    }),
    {
      parse: () => [],
    },
  ),
}));

const { mockCreateSystemPromptExtension } = vi.hoisted(() => ({
  mockCreateSystemPromptExtension: vi.fn(),
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
    speak = vi.fn().mockResolvedValue({
      ok: true,
      attemptedSegments: [],
      deliveredSegments: [],
      failedSegments: [],
      anomalies: [],
    });
    getSpeakElementPrompts = vi.fn().mockReturnValue([]);
  },
}));

vi.mock("../../../src/internal/bot/presentation.js", () => ({
  createPresenterCatalog: vi.fn().mockReturnValue({
    applyTo: vi.fn(),
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
  createExtensionBinding: vi.fn().mockResolvedValue({
    handlers: new Map(),
    tools: new Map(),
    speakElements: new Map(),
  }),
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

function createConfig() {
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
  };
}

function createDeps() {
  const observedSubscribers: Array<(observed: unknown) => Promise<void>> = [];
  const logger = {
    level: 2,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    ctx: {
      command: vi.fn().mockReturnValue({ action: vi.fn() }),
      logger: vi.fn().mockReturnValue(logger),
      on: vi.fn().mockReturnValue(vi.fn()),
    },
    modelService: {
      resolveChatModel: vi.fn().mockReturnValue({ model: {} }),
    },
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
      subscribeSessionRotated: vi.fn().mockReturnValue(vi.fn()),
    },
    platformGateway: {
      subscribe: vi.fn((subscriber: (observed: unknown) => Promise<void>) => {
        observedSubscribers.push(subscriber);
        return vi.fn();
      }),
    },
    observedSubscribers,
  };
}

describe("RuntimeController observed-event dispatch", () => {
  it("subscribes to observed events and creates channel session with presenter catalog", async () => {
    const { RuntimeController } = await import("../../../src/internal/runtime/controller.js");
    const { createExtensionBinding } = await import("../../../src/internal/extension/context.js");
    const deps = createDeps();
    const extension = {
      id: "test-extension",
      setup: vi.fn(),
    };
    mockCreateSystemPromptExtension.mockReturnValue({
      id: "yesimbot:system-prompt",
      setup: vi.fn(),
    });
    deps.extensionRegistry.getAllDefinitions.mockReturnValue([extension]);

    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig() as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      sessionStore: deps.sessionStore as never,
      platformGateway: deps.platformGateway as never,
    });

    await controller.start();

    expect(deps.platformGateway.subscribe).toHaveBeenCalledTimes(1);

    const subscriber = deps.observedSubscribers[0];
    const bot = { selfId: "bot-2", platform: "onebot", user: { name: "Athena" } };
    const originSession = { id: "session-1" };

    await subscriber({
      event: {
        id: "event-1",
        type: "message",
        timestamp: 1,
        source: {
          platform: "onebot",
          channelId: "group-1",
          sourceType: "group",
          selfId: "bot-2",
        },
        actor: { id: "user-1" },
        visible: true,
        payload: { messageId: "msg-1", content: "hello" },
        metadata: { persist: true, triggerCandidate: true },
      },
      content: [{ type: "text", text: "hello" }],
      bot,
      originSession,
    });

    expect(deps.sessionStore.getOrCreate).toHaveBeenCalledWith({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });
    expect(createExtensionBinding).toHaveBeenCalledWith(
      extension,
      expect.objectContaining({
        channel: expect.objectContaining({
          platform: "onebot",
          channelId: "group-1",
          type: "group",
        }),
      }),
    );
  });
});
