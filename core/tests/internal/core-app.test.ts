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

import * as CoreApp from "../../src/internal/core-app.js";
import { createCoreAppRuntime, type InternalRuntimeModule } from "../../src/internal/core-app.js";

function createMockCtx() {
  const disposeHandlers: Array<() => void | Promise<void>> = [];
  return {
    "yesimbot.model": {},
    "yesimbot.extension": {},
    database: {},
    logger: vi.fn().mockReturnValue({
      level: 2,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    on: vi.fn((event: string, handler: () => void | Promise<void>) => {
      if (event === "dispose") disposeHandlers.push(handler);
      return vi.fn();
    }),
    disposeHandlers,
  };
}

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

describe("Core App plugin shell", () => {
  it("declares public service injects without becoming a Koishi Service", () => {
    expect(CoreApp.name).toBe("yesimbot.core-app");
    expect(CoreApp.inject).toEqual(["yesimbot.model", "yesimbot.extension", "database"]);
    expect(CoreApp).not.toHaveProperty("service");
  });

  it("starts internal modules in order and stops them in reverse order", async () => {
    const order: string[] = [];
    const modules: InternalRuntimeModule[] = [
      {
        name: "session",
        start: vi.fn(async () => order.push("start:session")),
        stop: vi.fn(async () => order.push("stop:session")),
      },
      {
        name: "bot",
        start: vi.fn(async () => order.push("start:bot")),
        stop: vi.fn(async () => order.push("stop:bot")),
      },
      {
        name: "runtime",
        start: vi.fn(async () => order.push("start:runtime")),
        stop: vi.fn(async () => order.push("stop:runtime")),
      },
    ];

    const runtime = createCoreAppRuntime(createMockCtx() as never, createConfig(), () => modules);

    await runtime.start();
    await runtime.stop();

    expect(order).toEqual([
      "start:session",
      "start:bot",
      "start:runtime",
      "stop:runtime",
      "stop:bot",
      "stop:session",
    ]);
  });

  it("stops already-started modules in reverse order when startup fails", async () => {
    const order: string[] = [];
    const startupError = new Error("runtime failed");
    const modules: InternalRuntimeModule[] = [
      {
        name: "session",
        start: vi.fn(async () => order.push("start:session")),
        stop: vi.fn(async () => order.push("stop:session")),
      },
      {
        name: "bot",
        start: vi.fn(async () => order.push("start:bot")),
        stop: vi.fn(async () => order.push("stop:bot")),
      },
      {
        name: "runtime",
        start: vi.fn(async () => {
          order.push("start:runtime");
          throw startupError;
        }),
        stop: vi.fn(async () => order.push("stop:runtime")),
      },
    ];

    const runtime = createCoreAppRuntime(createMockCtx() as never, createConfig(), () => modules);

    await expect(runtime.start()).rejects.toThrow(startupError);
    await runtime.stop();

    expect(order).toEqual([
      "start:session",
      "start:bot",
      "start:runtime",
      "stop:bot",
      "stop:session",
    ]);
  });

  it("registers Core App dispose cleanup before startup completes", async () => {
    const ctx = createMockCtx();
    const startupError = new Error("runtime failed");

    await expect(
      CoreApp.apply(ctx as never, {
        ...createConfig(),
        createModules: () => [
          {
            name: "runtime",
            start: vi.fn(async () => {
              throw startupError;
            }),
            stop: vi.fn(),
          },
        ],
      }),
    ).rejects.toThrow(startupError);

    expect(ctx.on).toHaveBeenCalledWith("dispose", expect.any(Function));
  });

  it("registers Core App cleanup on Koishi dispose", async () => {
    const ctx = createMockCtx();
    const stop = vi.fn();
    const start = vi.fn();

    await CoreApp.apply(ctx as never, {
      ...createConfig(),
      createModules: () => [{ name: "runtime", start, stop }],
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(ctx.on).toHaveBeenCalledWith("dispose", expect.any(Function));

    await ctx.disposeHandlers[0]();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
