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
      registerExtension: vi.fn().mockResolvedValue(undefined),
      getAllDefinitions: vi.fn().mockReturnValue([]),
    },
    sessionStore: {
      subscribeSessionRotated: vi.fn().mockReturnValue(vi.fn()),
    },
    platformGateway: {
      subscribe: vi.fn().mockReturnValue(vi.fn()),
    },
  };
}

describe("RuntimeController lifecycle", () => {
  it("stops by disposing observed-event subscription and all channel sessions", async () => {
    const deps = createMockDeps();
    const controller = new RuntimeController({
      ctx: deps.ctx as never,
      config: createConfig() as never,
      modelService: deps.modelService as never,
      extensionRegistry: deps.extensionRegistry as never,
      sessionStore: deps.sessionStore as never,
      platformGateway: deps.platformGateway as never,
    });
    const controllerAccess = controller as unknown as {
      channels: Map<string, { dispose(): void; koishiBot: { selfId: string } }>;
      disposeSessionRotated?: () => void;
      disposeEventSubscription?: () => void;
      started: boolean;
    };

    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const disposeSessionRotated = vi.fn();
    const disposeEventSubscription = vi.fn();
    const channelA = {
      koishiBot: { selfId: "bot-1" },
      dispose: disposeA,
    };
    const channelB = {
      koishiBot: { selfId: "bot-2" },
      dispose: disposeB,
    };

    controllerAccess.channels = new Map([
      ["onebot:group-1", channelA],
      ["discord:dm-2", channelB],
    ]);
    controllerAccess.disposeSessionRotated = disposeSessionRotated;
    controllerAccess.disposeEventSubscription = disposeEventSubscription;
    controllerAccess.started = true;

    await controller.stop();

    expect(disposeSessionRotated).toHaveBeenCalledTimes(1);
    expect(disposeEventSubscription).toHaveBeenCalledTimes(1);
    expect(controllerAccess.disposeSessionRotated).toBeUndefined();
    expect(controllerAccess.disposeEventSubscription).toBeUndefined();
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
    expect(controllerAccess.channels.size).toBe(0);
  });
});
