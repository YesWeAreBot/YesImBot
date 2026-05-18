import { Context } from "koishi";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { GenericAdapter } from "../../src/adapter/generic.js";
import type { AthenaEvent } from "../../src/adapter/types.js";

function createMockCtx(): Context {
  let middlewareHandler: ((session: unknown, next: unknown) => unknown) | null = null;
  return {
    middleware(handler: (session: unknown, next: unknown) => unknown) {
      middlewareHandler = handler;
      return () => {
        middlewareHandler = null;
      };
    },
    platform: vi.fn().mockReturnThis(),
    on: vi.fn(),
    get _middlewareHandler() {
      return middlewareHandler;
    },
  } as unknown as Context;
}

function createMockSession(overrides: Record<string, any> = {}) {
  return {
    platform: "telegram",
    channelId: "chan1",
    isDirect: false,
    messageId: "msg1",
    content: "hello world",
    elements: [{ type: "text", attrs: { content: "hello world" }, children: [] }],
    author: { id: "user1", name: "Bob", avatar: "http://avatar.png" },
    quote: null,
    stripped: { atSelf: true },
    bot: { selfId: "bot1" },
    cid: "telegram:chan1",
    ...overrides,
  };
}

describe("GenericAdapter", () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let emitted: AthenaEvent[];
  let adapter: GenericAdapter;

  beforeEach(() => {
    ctx = createMockCtx();
    emitted = [];
    adapter = new GenericAdapter(ctx, {});
    adapter.install((event) => emitted.push(event));
  });

  it("should register a middleware", () => {
    expect(ctx._middlewareHandler).not.toBeNull();
  });

  it("should convert a basic message session to ChatMessageEvent", async () => {
    const session = createMockSession();
    const next = vi.fn();
    await ctx._middlewareHandler!(session, next);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].kind).toBe("chat_message");
    expect(emitted[0].source.platform).toBe("telegram");
    expect(emitted[0].source.channelId).toBe("chan1");
    expect(emitted[0].source.conversationType).toBe("group");
    expect(emitted[0].actor.id).toBe("user1");
    expect(emitted[0].actor.name).toBe("Bob");
    expect(emitted[0].payload.messageId).toBe("msg1");
    expect(emitted[0].payload.content).toBe("hello world");
    expect(emitted[0].metadata.persist).toBe(true);
    expect(emitted[0].metadata.triggerCandidate).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it("should set conversationType to private for direct messages", async () => {
    const session = createMockSession({ isDirect: true, stripped: { atSelf: false } });
    const next = vi.fn();
    await ctx._middlewareHandler!(session, next);

    expect(emitted[0].source.conversationType).toBe("private");
    expect(emitted[0].metadata.triggerCandidate).toBe(true);
  });

  it("should set triggerCandidate false when not mentioned and not direct", async () => {
    const session = createMockSession({ isDirect: false, stripped: { atSelf: false } });
    const next = vi.fn();
    await ctx._middlewareHandler!(session, next);

    expect(emitted[0].metadata.triggerCandidate).toBe(false);
  });

  it("should set triggerCandidate true when at element targets bot", async () => {
    const session = createMockSession({
      isDirect: false,
      stripped: { atSelf: false },
      elements: [
        { type: "at", attrs: { id: "bot1" }, children: [] },
        { type: "text", attrs: { content: "hello" }, children: [] },
      ],
    });
    const next = vi.fn();
    await ctx._middlewareHandler!(session, next);

    expect(emitted[0].metadata.triggerCandidate).toBe(true);
  });

  it("should include quote info when session has a quote", async () => {
    const session = createMockSession({
      quote: { id: "quoted-msg", userId: "u2", username: "Carol", content: "original" },
    });
    const next = vi.fn();
    await ctx._middlewareHandler!(session, next);

    expect(emitted[0].payload.quoteMessageId).toBe("quoted-msg");
    expect(emitted[0].payload.quoteSender).toEqual({ id: "u2", name: "Carol" });
  });

  it("should provide a default chat_message formatter", () => {
    expect(adapter.formatters).toBeDefined();
    expect(adapter.formatters!.chat_message).toBeTypeOf("function");
  });
});
