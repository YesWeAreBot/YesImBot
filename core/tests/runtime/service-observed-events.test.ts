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

vi.mock("koishi", () => {
  class Service {
    ctx: unknown;
    [Symbol.for("koishi.tracker")]: unknown;

    constructor(ctx: unknown, _name: string) {
      this.ctx = ctx;
    }

    protected start() {}
    protected stop() {}
  }

  return {
    Bot: class {},
    Context: class {},
    Logger: class {},
    Service,
  };
});

vi.mock("@yesimbot/agent/agent", () => ({
  Agent: class {
    signal = new AbortController().signal;
    state = {
      model: {},
      isStreaming: false,
      systemPrompt: "",
    };

    hasQueuedMessages() {
      return false;
    }

    abort() {}
  },
}));

vi.mock("@yesimbot/agent/ai", () => ({
  ChatModelRef: class {},
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

vi.mock("../../src/bot/athena-bot.js", () => ({
  AthenaBot: class {
    getSpeakElementPrompts = vi.fn().mockReturnValue([]);
  },
}));

vi.mock("../../src/bot/presenter.js", () => ({
  createPresenterRegistry: mockCreatePresenterRegistry,
}));

vi.mock("../../src/bot/speak-elements.js", () => ({
  createSpeakElementRegistry: mockCreateSpeakElementRegistry,
}));

vi.mock("../../src/extension/built-in/system-prompt.js", () => ({
  createSystemPromptExtension: mockCreateSystemPromptExtension,
}));

vi.mock("../../src/runtime/channel-runtime.js", () => ({
  createChannelRuntime: mockCreateChannelRuntime,
}));

vi.mock("../../src/runtime/helpers.js", () => ({
  buildAgentSessionConfig: mockBuildAgentSessionConfig,
}));

vi.mock("../../src/runtime/settings-manager.js", () => ({
  RuntimeSettingsManager: class {
    settings = { delivery: {} };
  },
}));

vi.mock("../../src/runtime/willing.js", () => ({
  WillingnessManager: class {
    shouldReply() {
      return { decision: false, probability: 0 };
    }
  },
}));

function createMockCtx() {
  const observedSubscribers: Array<(observed: unknown) => Promise<void>> = [];
  const onHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const logger = {
    level: 2,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    "yesimbot.bot": {
      subscribeObservedEvents: vi.fn((subscriber: (observed: unknown) => Promise<void>) => {
        observedSubscribers.push(subscriber);
        return vi.fn(() => {
          const index = observedSubscribers.indexOf(subscriber);
          if (index >= 0) observedSubscribers.splice(index, 1);
        });
      }),
      applyPresentersTo: mockApplyPresentersTo,
    },
    "yesimbot.extension": {
      registerExtension: vi.fn().mockResolvedValue(undefined),
      createChannelRuntime: vi.fn().mockResolvedValue(undefined),
      disposeChannelRuntime: vi.fn().mockResolvedValue(undefined),
      getPromptToolContext: vi.fn().mockReturnValue({}),
      getPromptSpeakElementContext: vi.fn().mockReturnValue({ elements: [] }),
    },
    "yesimbot.model": {
      resolveChatModel: vi.fn().mockReturnValue({ model: {} }),
    },
    "yesimbot.session": {
      getChannelDir: vi.fn().mockReturnValue("/tmp/athena-test/channel"),
      getOrCreate: vi.fn().mockResolvedValue({
        buildSessionContext: vi.fn().mockReturnValue({ messages: [] }),
        appendCustomEntry: vi.fn(),
        appendSessionInfo: vi.fn(),
        getSessionName: vi.fn(),
      }),
    },
    command: vi.fn().mockReturnValue({ action: vi.fn() }),
    logger: vi.fn().mockReturnValue(logger),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      onHandlers.set(event, handler);
      return vi.fn(() => onHandlers.delete(event));
    }),
    get observedSubscribers() {
      return observedSubscribers;
    },
    get onHandlers() {
      return onHandlers;
    },
  };
}

describe("RuntimeService observed-event dispatch", () => {
  it("subscribes to observed events and applies bot presenters when creating channel runtime", async () => {
    vi.resetModules();
    const { RuntimeService } = await import("../../src/runtime/service.js");
    const ctx = createMockCtx();
    mockCreatePresenterRegistry.mockReturnValue({
      registerBase: vi.fn(),
    });
    mockCreateSpeakElementRegistry.mockReturnValue({
      register: vi.fn(),
    });
    mockCreateSystemPromptExtension.mockReturnValue({});
    mockCreateChannelRuntime.mockReturnValue({
      handleEvent: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    });

    const service = new RuntimeService(ctx as never, {
      basePath: "/tmp/athena-test",
      chatModel: "test-model",
      allowedChannels: [],
      logLevel: 2,
    });

    await service.start();

    expect(ctx["yesimbot.bot"].subscribeObservedEvents).toHaveBeenCalledTimes(1);

    const subscriber = ctx.observedSubscribers[0];
    const bot = { selfId: "bot-2", platform: "onebot", user: { name: "Athena" } };
    const originSession = { id: "session-1" };
    const handleEvent = vi.fn().mockResolvedValue(undefined);
    mockCreateChannelRuntime.mockReturnValueOnce({
      handleEvent,
      dispose: vi.fn(),
    });

    await subscriber({
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
      bot,
      originSession,
    });

    expect(ctx["yesimbot.session"].getOrCreate).toHaveBeenCalledWith(
      "onebot",
      "group-1",
      "group",
      "bot-2",
    );
    expect(mockApplyPresentersTo).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "event-1" }), {
      originSession,
    });
  });
});
