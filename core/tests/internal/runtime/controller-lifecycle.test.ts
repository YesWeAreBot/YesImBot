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

import { RuntimeController } from "../../../src/internal/runtime/controller.js";

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

function createMockDeps() {
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
      registerExtension: vi.fn().mockResolvedValue({
        totalChannels: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
        allSucceeded: true,
      }),
    },
    extensionRuntimeManager: {
      disposeChannelRuntime: vi.fn().mockResolvedValue(undefined),
      getPromptToolContext: vi.fn().mockReturnValue({
        selectedTools: [],
        toolSnippets: {},
        promptGuidelines: [],
      }),
      getPromptSpeakElementContext: vi.fn().mockReturnValue({ elements: [] }),
    },
    sessionStore: {
      subscribeSessionRotated: vi.fn().mockReturnValue(vi.fn()),
    },
    botModule: {
      subscribeObservedEvents: vi.fn().mockReturnValue(vi.fn()),
      applyPresentersTo: vi.fn(),
    },
  };
}

describe("RuntimeController lifecycle", () => {
  it("stops by disposing observed-event subscription and all channel contexts", async () => {
    const deps = createMockDeps();
    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig() as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      extensionRuntimeManager: deps.extensionRuntimeManager as never,
      sessionStore: deps.sessionStore as never,
      botModule: deps.botModule as never,
    });
    const controllerAccess = controller as unknown as {
      channels: Map<
        string,
        {
          platform: string;
          channelId: string;
          type: "private" | "group";
          runtime: { dispose(): void };
        }
      >;
      channelBotInfo: Map<string, { selfId: string; selfName: string }>;
      disposeSessionRotated?: () => void;
      disposeObservedEventSubscription?: () => void;
      started: boolean;
    };

    const runtimeA = { dispose: vi.fn() };
    const runtimeB = { dispose: vi.fn() };
    const disposeSessionRotated = vi.fn();
    const disposeObservedEventSubscription = vi.fn();
    const channelA = {
      platform: "onebot",
      channelId: "group-1",
      type: "group" as const,
      runtime: runtimeA,
    };
    const channelB = {
      platform: "discord",
      channelId: "dm-2",
      type: "private" as const,
      runtime: runtimeB,
    };

    controllerAccess.channels = new Map([
      ["onebot:group-1", channelA],
      ["discord:dm-2", channelB],
    ]);
    controllerAccess.channelBotInfo = new Map([
      ["onebot:group-1", { selfId: "bot-1", selfName: "Athena" }],
      ["discord:dm-2", { selfId: "bot-2", selfName: "Athena" }],
    ]);
    controllerAccess.disposeSessionRotated = disposeSessionRotated;
    controllerAccess.disposeObservedEventSubscription = disposeObservedEventSubscription;
    controllerAccess.started = true;

    await controller.stop();

    expect(disposeSessionRotated).toHaveBeenCalledTimes(1);
    expect(disposeObservedEventSubscription).toHaveBeenCalledTimes(1);
    expect(controllerAccess.disposeSessionRotated).toBeUndefined();
    expect(controllerAccess.disposeObservedEventSubscription).toBeUndefined();
    expect(deps.extensionRuntimeManager.disposeChannelRuntime).toHaveBeenNthCalledWith(1, {
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });
    expect(deps.extensionRuntimeManager.disposeChannelRuntime).toHaveBeenNthCalledWith(2, {
      platform: "discord",
      channelId: "dm-2",
      type: "private",
    });
    expect(runtimeA.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeB.dispose).toHaveBeenCalledTimes(1);
    expect(controllerAccess.channels.size).toBe(0);
    expect(controllerAccess.channelBotInfo.size).toBe(0);
  });
});
