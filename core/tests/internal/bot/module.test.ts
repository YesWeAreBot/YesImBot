import { describe, expect, it, vi } from "vitest";

import { BotModule } from "../../../src/internal/bot/module.js";

function createBotList(
  ...bots: Array<{ selfId: string; platform: string; user: { name: string } }>
) {
  const botList = [...bots] as Array<(typeof bots)[number]> & Record<string, (typeof bots)[number]>;
  for (const bot of bots) {
    botList[`${bot.platform}:${bot.selfId}`] = bot;
  }
  return botList;
}

function createIterableOnlyBotList(
  ...bots: Array<{ selfId: string; platform: string; user: { name: string } }>
) {
  return {
    [Symbol.iterator]: () => bots[Symbol.iterator](),
  };
}

function createMockCtx(
  options: {
    bots?: ReturnType<typeof createBotList> | ReturnType<typeof createIterableOnlyBotList>;
  } = {},
) {
  let middlewareHandler: ((session: unknown, next: () => unknown) => unknown) | undefined;
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const eventDisposers = new Map<string, ReturnType<typeof vi.fn>>();
  const logger = {
    level: 2,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const bots =
    options.bots ??
    createBotList(
      { selfId: "bot-1", platform: "onebot", user: { name: "Athena" } },
      { selfId: "bot-2", platform: "onebot", user: { name: "Athena Alt" } },
    );

  return {
    bots,
    database: {
      get: vi.fn().mockResolvedValue([]),
    },
    middleware(handler: (session: unknown, next: () => unknown) => unknown) {
      middlewareHandler = handler;
      return () => {
        middlewareHandler = undefined;
      };
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      events.set(event, handler);
      const dispose = vi.fn(() => {
        events.delete(event);
      });
      eventDisposers.set(event, dispose);
      return dispose;
    }),
    emit: vi.fn(),
    logger: vi.fn().mockReturnValue(logger),
    get middlewareHandler() {
      return middlewareHandler;
    },
    get events() {
      return events;
    },
    get eventDisposers() {
      return eventDisposers;
    },
    get testLogger() {
      return logger;
    },
  };
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    platform: "onebot",
    channelId: "group-1",
    guildId: "guild-1",
    isDirect: false,
    selfId: "bot-1",
    messageId: "m-1",
    content: "hello",
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    author: { id: "user-1", name: "Alice" },
    userId: "user-1",
    stripped: { atSelf: false },
    bot: { selfId: "bot-1", platform: "onebot", user: { name: "Athena" } },
    send: vi.fn(),
    ...overrides,
  };
}

function createEvent() {
  return {
    id: "event-1",
    kind: "chat_message" as const,
    timestamp: 1,
    source: {
      platform: "onebot",
      channelId: "group-1",
      conversationType: "group" as const,
    },
    actor: { id: "user-1" },
    payload: { messageId: "m-1", content: "hello" },
    metadata: { persist: true, triggerCandidate: true },
  };
}

describe("BotModule", () => {
  it("rejects duplicate observer names", () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const observer = {
      name: "test.message",
      source: { kind: "middleware" as const },
      priority: 10,
      eventKinds: ["chat_message" as const],
      handle: vi.fn().mockResolvedValue({ type: "pass" as const }),
    };

    module.registerObserver(observer);

    expect(() => module.registerObserver(observer)).toThrow(
      'Event observer "test.message" is already registered',
    );
  });

  it("installs middleware source when first middleware observer is registered", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    module.registerObserver({
      name: "test.message",
      source: { kind: "middleware" },
      priority: 10,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({ type: "pass" }),
    });

    await module.start();

    expect(ctx.middlewareHandler).toBeDefined();
  });

  it("installs and disposes koishi event listeners by source reference", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    module.registerObserver({
      name: "test.custom.high",
      source: { kind: "koishi-event", eventName: "platform-custom" },
      priority: 10,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({ type: "pass" }),
    });
    module.registerObserver({
      name: "test.custom.low",
      source: { kind: "koishi-event", eventName: "platform-custom" },
      priority: 0,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({ type: "pass" }),
    });

    await module.start();

    expect(ctx.on).toHaveBeenCalledWith("platform-custom", expect.any(Function));
    expect(ctx.events.has("platform-custom")).toBe(true);

    module.unregisterObserver("test.custom.high");
    expect(ctx.events.has("platform-custom")).toBe(true);

    module.unregisterObserver("test.custom.low");
    expect(ctx.eventDisposers.get("platform-custom")).toHaveBeenCalledTimes(1);
    expect(ctx.events.has("platform-custom")).toBe(false);
  });

  it("allows only one observed-event subscriber", () => {
    const module = new BotModule({
      ctx: createMockCtx() as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    module.subscribeObservedEvents(vi.fn());

    expect(() => module.subscribeObservedEvents(vi.fn())).toThrow(
      "BotModule already has an observed-event subscriber",
    );
  });

  it("runs matching observers by priority and publishes the first event", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);
    const order: string[] = [];
    const low = vi.fn().mockImplementation(async () => {
      order.push("low");
      return { type: "event", event: createEvent() };
    });
    const high = vi.fn().mockImplementation(async () => {
      order.push("high");
      return { type: "pass" };
    });

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "low",
      source: { kind: "middleware" },
      priority: 1,
      eventKinds: ["chat_message"],
      handle: low,
    });
    module.registerObserver({
      name: "high",
      source: { kind: "middleware" },
      priority: 10,
      eventKinds: ["chat_message"],
      handle: high,
    });
    await module.start();

    const session = createSession();
    await ctx.middlewareHandler?.(session, vi.fn());

    expect(order).toEqual(["high", "low"]);
    expect(subscriber).toHaveBeenCalledWith({
      event: expect.objectContaining({ id: "event-1" }),
      bot: session.bot,
      originSession: session,
    });
  });

  it("drop stops fallback and does not publish", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);
    const low = vi.fn().mockResolvedValue({ type: "event", event: createEvent() });
    const high = vi.fn().mockResolvedValue({ type: "drop" });

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "high",
      source: { kind: "middleware" },
      priority: 10,
      eventKinds: ["chat_message"],
      handle: high,
    });
    module.registerObserver({
      name: "low",
      source: { kind: "middleware" },
      priority: 0,
      eventKinds: ["chat_message"],
      handle: low,
    });
    await module.start();

    await ctx.middlewareHandler?.(createSession(), vi.fn());

    expect(low).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("observer exception stops fallback and logs an error", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const low = vi.fn().mockResolvedValue({ type: "event", event: createEvent() });
    const high = vi.fn().mockRejectedValue(new Error("boom"));

    module.registerObserver({
      name: "high",
      source: { kind: "middleware" },
      priority: 10,
      eventKinds: ["chat_message"],
      handle: high,
    });
    module.registerObserver({
      name: "low",
      source: { kind: "middleware" },
      priority: 0,
      eventKinds: ["chat_message"],
      handle: low,
    });
    await module.start();

    await ctx.middlewareHandler?.(createSession(), vi.fn());

    expect(low).not.toHaveBeenCalled();
    expect(ctx.testLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Event observer "high" failed'),
    );
  });

  it("uses Session Store metadata for assignee fallback", async () => {
    const ctx = createMockCtx();
    const sessionStore = { getMetadata: vi.fn().mockResolvedValue({ assignee: "bot-2" }) };
    const module = new BotModule({ ctx: ctx as never, sessionStore, config: { logLevel: 2 } });
    const subscriber = vi.fn().mockResolvedValue(undefined);

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "message",
      source: { kind: "middleware" },
      priority: 1,
      eventKinds: ["chat_message"],
      handle: vi.fn(async () => ({
        type: "event",
        event: createEvent(),
      })),
    });

    await module.start();
    await ctx.middlewareHandler?.(
      createSession({ bot: { selfId: "bot-1", platform: "onebot" } }),
      vi.fn(),
    );

    expect(subscriber).not.toHaveBeenCalled();
  });

  it("rejects observer registration when event kind has no presenter coverage", () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    expect(() =>
      module.registerObserver({
        name: "platform.poke",
        source: { kind: "koishi-event", eventName: "platform-poke" },
        priority: 100,
        eventKinds: ["poke"],
        handle: vi.fn().mockResolvedValue({ type: "pass" }),
      }),
    ).toThrow(
      'Event observer "platform.poke" declares event kind "poke" without presenter coverage',
    );
  });

  it("accepts observer registration when it provides presenter coverage", () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    expect(() =>
      module.registerObserver({
        name: "platform.poke",
        source: { kind: "koishi-event", eventName: "platform-poke" },
        priority: 100,
        eventKinds: ["poke"],
        presenters: {
          poke: (event) => ({
            visible: true,
            content: `poke ${event.payload.targetId}`,
            text: `poke ${event.payload.targetId}`,
            details: { kind: event.kind },
          }),
        },
        handle: vi.fn().mockResolvedValue({ type: "pass" }),
      }),
    ).not.toThrow();
  });

  it("cleans up observer presenters when registration fails", () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    expect(() =>
      module.registerObserver({
        name: "platform.partial",
        source: { kind: "koishi-event", eventName: "platform-partial" },
        priority: 100,
        eventKinds: ["poke"],
        presenters: {
          poke: (event) => ({
            visible: true,
            content: `poke ${event.payload.targetId}`,
            text: `poke ${event.payload.targetId}`,
            details: { kind: event.kind },
          }),
          chat_message: (event) => ({
            visible: true,
            content: event.payload.content,
            text: event.payload.content,
            details: { kind: event.kind },
          }),
        },
        handle: vi.fn().mockResolvedValue({ type: "pass" }),
      }),
    ).toThrow('Base presenter for "chat_message" is already registered');

    expect(() =>
      module.registerObserver({
        name: "platform.poke-after-failure",
        source: { kind: "koishi-event", eventName: "platform-poke-after-failure" },
        priority: 100,
        eventKinds: ["poke"],
        handle: vi.fn().mockResolvedValue({ type: "pass" }),
      }),
    ).toThrow(
      'Event observer "platform.poke-after-failure" declares event kind "poke" without presenter coverage',
    );
  });

  it("rejects invalid observer sources", () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    expect(() =>
      module.registerObserver({
        name: "platform.invalid",
        source: { kind: "koishi-event", eventName: "" },
        priority: 100,
        eventKinds: ["chat_message"],
        handle: vi.fn().mockResolvedValue({ type: "pass" }),
      }),
    ).toThrow('Event observer "platform.invalid" has an invalid source');
  });

  it("registers core fallback observers when started", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });

    await module.start();

    expect(ctx.middlewareHandler).toBeDefined();
    for (const eventName of [
      "message-deleted",
      "reaction-added",
      "reaction-removed",
      "guild-member-added",
      "guild-member-removed",
    ]) {
      expect(ctx.events.has(eventName)).toBe(true);
    }
  });

  it("post-gates non-assignee observations before publishing", async () => {
    const ctx = createMockCtx();
    ctx.database.get.mockResolvedValue([{ assignee: "bot-2" }]);
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "platform.custom",
      source: { kind: "koishi-event", eventName: "platform-custom" },
      priority: 100,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({
        type: "event",
        event: {
          ...createEvent(),
          source: { ...createEvent().source, selfId: "bot-1" },
        },
      }),
    });
    await module.start();

    await ctx.events.get("platform-custom")?.({ platform: "onebot", channelId: "group-1" });

    expect(subscriber).not.toHaveBeenCalled();
    expect(ctx.testLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Dropped observed event for non-assignee bot"),
    );
  });

  it("keeps Session-backed observations on the receiving bot", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "platform.session-custom",
      source: { kind: "middleware" },
      priority: 100,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({
        type: "event",
        event: {
          ...createEvent(),
          source: { ...createEvent().source, selfId: "bot-2" },
        },
      }),
    });
    await module.start();

    const session = createSession();
    await ctx.middlewareHandler?.(session, vi.fn());

    expect(subscriber).toHaveBeenCalledWith({
      event: expect.objectContaining({
        source: expect.objectContaining({ selfId: "bot-1" }),
      }),
      bot: session.bot,
      originSession: session,
    });
    expect(ctx.testLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Ignored observer-provided selfId"),
    );
  });

  it("resolves non-session event bot from Koishi assignee", async () => {
    const ctx = createMockCtx();
    ctx.database.get.mockResolvedValue([{ assignee: "bot-2" }]);
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "platform.custom",
      source: { kind: "koishi-event", eventName: "platform-custom" },
      priority: 100,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({
        type: "event",
        event: createEvent(),
      }),
    });
    await module.start();

    await ctx.events.get("platform-custom")?.({ platform: "onebot", channelId: "group-1" });

    expect(subscriber).toHaveBeenCalledWith({
      event: expect.objectContaining({
        source: expect.objectContaining({ selfId: "bot-2" }),
      }),
      bot: ctx.bots["onebot:bot-2"],
      originSession: undefined,
    });
  });

  it("resolves unambiguous non-session bot from iterable Koishi bot list", async () => {
    const bot = { selfId: "bot-1", platform: "onebot", user: { name: "Athena" } };
    const ctx = createMockCtx({
      bots: createIterableOnlyBotList(bot),
    });
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "platform.custom",
      source: { kind: "koishi-event", eventName: "platform-custom" },
      priority: 100,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({
        type: "event",
        event: createEvent(),
      }),
    });
    await module.start();

    await ctx.events.get("platform-custom")?.({ platform: "onebot", channelId: "group-1" });

    expect(subscriber).toHaveBeenCalledWith({
      event: expect.objectContaining({
        source: expect.objectContaining({ selfId: "bot-1" }),
      }),
      bot,
      originSession: undefined,
    });
  });

  it("drops ambiguous non-session event when multiple platform bots exist", async () => {
    const ctx = createMockCtx();
    const module = new BotModule({
      ctx: ctx as never,
      sessionStore: { getMetadata: vi.fn().mockResolvedValue(null) },
      config: { logLevel: 2 },
    });
    const subscriber = vi.fn().mockResolvedValue(undefined);

    module.subscribeObservedEvents(subscriber);
    module.registerObserver({
      name: "platform.custom",
      source: { kind: "koishi-event", eventName: "platform-custom" },
      priority: 100,
      eventKinds: ["chat_message"],
      handle: vi.fn().mockResolvedValue({
        type: "event",
        event: createEvent(),
      }),
    });
    await module.start();

    await ctx.events.get("platform-custom")?.({ platform: "onebot", channelId: "group-1" });

    expect(subscriber).not.toHaveBeenCalled();
    expect(ctx.testLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Ambiguous Koishi bot"),
    );
  });
});
