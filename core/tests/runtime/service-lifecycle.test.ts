import { describe, expect, it, vi } from "vitest";

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
  Agent: class {},
}));

vi.mock("@yesimbot/agent/ai", () => ({}));

vi.mock("@yesimbot/agent/session", () => ({
  AgentSession: class {},
  HookRunner: class {},
  SessionManager: class {},
  convertToLlm: vi.fn(),
}));

vi.mock("../../src/bot/athena-bot.js", () => ({
  AthenaBot: class {},
}));

vi.mock("../../src/bot/presenter.js", () => ({
  createDefaultChatMessagePresenter: vi.fn(),
  createPresenterRegistry: vi.fn(),
}));

vi.mock("../../src/bot/speak-elements.js", () => ({
  createSpeakElementRegistry: vi.fn(),
}));

vi.mock("../../src/extension/built-in/system-prompt.js", () => ({
  createSystemPromptExtension: vi.fn(),
}));

vi.mock("../../src/runtime/channel-runtime.js", () => ({
  createChannelRuntime: vi.fn(),
}));

vi.mock("../../src/runtime/helpers.js", () => ({
  buildAgentSessionConfig: vi.fn(),
}));

vi.mock("../../src/runtime/settings-manager.js", () => ({
  RuntimeSettingsManager: class {},
}));

vi.mock("../../src/runtime/willing.js", () => ({
  WillingnessManager: class {
    shouldReply() {
      return { decision: false, probability: 0 };
    }
  },
}));

import { RuntimeService } from "../../src/runtime/service.js";

interface RuntimeServiceTestAccess {
  _channels: Map<
    string,
    { platform: string; channelId: string; type: "private" | "group"; runtime: { dispose(): void } }
  >;
  _channelBotInfo: Map<string, { selfId: string; selfName: string }>;
  _disposeSessionNewHandler?: () => void;
  _disposeObservedEventSubscription?: () => void;
  stop(): Promise<void>;
}

function createMockCtx() {
  return {
    "yesimbot.bot": {
      subscribeObservedEvents: vi.fn().mockReturnValue(vi.fn()),
    },
    "yesimbot.extension": {
      disposeChannelRuntime: vi.fn().mockResolvedValue(undefined),
    },
    logger: vi.fn().mockReturnValue({
      level: 2,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
}

describe("RuntimeService lifecycle", () => {
  it("stops by disposing observed-event subscription and all channel contexts", async () => {
    const ctx = createMockCtx();
    const service = new RuntimeService(ctx as never, {
      basePath: "/tmp/athena-test",
      chatModel: "test-model",
      allowedChannels: [],
      logLevel: 2,
    });
    const serviceAccess = service as unknown as RuntimeServiceTestAccess;

    const runtimeA = { dispose: vi.fn() };
    const runtimeB = { dispose: vi.fn() };
    const disposeSessionNewHandler = vi.fn();
    const disposeObservedEventSubscription = vi.fn();
    const channelA = {
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      runtime: runtimeA,
    };
    const channelB = {
      platform: "discord",
      channelId: "dm-2",
      type: "private",
      runtime: runtimeB,
    };

    serviceAccess._channels = new Map([
      ["onebot:group-1", channelA],
      ["discord:dm-2", channelB],
    ]);
    serviceAccess._channelBotInfo = new Map([
      ["onebot:group-1", { selfId: "bot-1", selfName: "Athena" }],
      ["discord:dm-2", { selfId: "bot-2", selfName: "Athena" }],
    ]);
    serviceAccess._disposeSessionNewHandler = disposeSessionNewHandler;
    serviceAccess._disposeObservedEventSubscription = disposeObservedEventSubscription;

    await serviceAccess.stop();

    expect(disposeSessionNewHandler).toHaveBeenCalledTimes(1);
    expect(disposeObservedEventSubscription).toHaveBeenCalledTimes(1);
    expect(serviceAccess._disposeSessionNewHandler).toBeUndefined();
    expect(serviceAccess._disposeObservedEventSubscription).toBeUndefined();
    expect(ctx["yesimbot.extension"].disposeChannelRuntime).toHaveBeenNthCalledWith(1, {
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });
    expect(ctx["yesimbot.extension"].disposeChannelRuntime).toHaveBeenNthCalledWith(2, {
      platform: "discord",
      channelId: "dm-2",
      type: "private",
    });
    expect(runtimeA.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeB.dispose).toHaveBeenCalledTimes(1);
    expect(serviceAccess._channels.size).toBe(0);
    expect(serviceAccess._channelBotInfo.size).toBe(0);
  });
});
