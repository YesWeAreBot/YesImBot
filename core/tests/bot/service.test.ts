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
    Context: class {},
    Logger: class {},
    Service,
  };
});

import { AthenaBotService } from "../../src/bot/service.js";

function createMockCtx() {
  let middlewareHandler: ((session: unknown, next: () => unknown) => unknown) | undefined;
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const eventDisposers = new Map<string, ReturnType<typeof vi.fn>>();

  return {
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
    logger: vi.fn().mockReturnValue({
      level: 2,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    get middlewareHandler() {
      return middlewareHandler;
    },
    get events() {
      return events;
    },
    get eventDisposers() {
      return eventDisposers;
    },
  };
}

function createSession() {
  return {
    type: "message",
    platform: "onebot",
    channelId: "group-1",
    isDirect: false,
    messageId: "m-1",
    content: "hello",
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    author: { id: "user-1", name: "Alice" },
    userId: "user-1",
    stripped: { atSelf: false },
    bot: { selfId: "bot-1", user: { name: "Athena" } },
    send: vi.fn(),
  };
}

describe("AthenaBotService", () => {
  it("registers message middleware and calls next by default", async () => {
    const ctx = createMockCtx();
    const service = new AthenaBotService(ctx as never, { logLevel: 2 });
    const handleSession = vi.fn().mockResolvedValue(undefined);

    service.setSessionHandler(handleSession);
    await service.start();

    const session = createSession();
    const next = vi.fn();
    await ctx.middlewareHandler!(session, next);

    expect(handleSession).toHaveBeenCalledWith(session);
    expect(next).toHaveBeenCalled();
  });

  it("registers non-message session events and reuses the same session handler", async () => {
    const ctx = createMockCtx();
    const service = new AthenaBotService(ctx as never, { logLevel: 2 });
    const handleSession = vi.fn().mockResolvedValue(undefined);

    service.setSessionHandler(handleSession);
    await service.start();

    const eventNames = [
      "message-deleted",
      "reaction-added",
      "reaction-removed",
      "guild-member-added",
      "guild-member-removed",
    ];
    expect(ctx.on).toHaveBeenCalledTimes(eventNames.length);

    for (const eventName of eventNames) {
      const session = createSession({ type: eventName });
      await ctx.events.get(eventName)?.(session);
      expect(handleSession).toHaveBeenCalledWith(session);
    }
  });

  it("can consume messages when configured", async () => {
    const ctx = createMockCtx();
    const service = new AthenaBotService(ctx as never, {
      logLevel: 2,
      consumeMessages: true,
    });

    service.setSessionHandler(vi.fn().mockResolvedValue(undefined));
    await service.start();

    const next = vi.fn();
    await ctx.middlewareHandler!(createSession(), next);

    expect(next).not.toHaveBeenCalled();
  });

  it("clears the session handler on stop", async () => {
    const ctx = createMockCtx();
    const service = new AthenaBotService(ctx as never, { logLevel: 2 });
    const handleSession = vi.fn().mockResolvedValue(undefined);

    service.setSessionHandler(handleSession);
    await service.start();
    service.stop();

    expect(ctx.middlewareHandler).toBeUndefined();

    await service.start();

    const next = vi.fn();
    await ctx.middlewareHandler!(createSession(), next);

    expect(handleSession).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("disposes non-message event handlers on stop", async () => {
    const ctx = createMockCtx();
    const service = new AthenaBotService(ctx as never, { logLevel: 2 });

    await service.start();
    service.stop();

    for (const eventName of [
      "message-deleted",
      "reaction-added",
      "reaction-removed",
      "guild-member-added",
      "guild-member-removed",
    ]) {
      expect(ctx.eventDisposers.get(eventName)).toHaveBeenCalledTimes(1);
      expect(ctx.events.has(eventName)).toBe(false);
    }
  });
});
