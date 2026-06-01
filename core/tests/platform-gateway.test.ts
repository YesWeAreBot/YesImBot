import type { Bot, Fragment } from "koishi";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { PlatformGateway } from "../src/internal/platform/gateway.js";
import type { PlatformAdapter, PlatformListener } from "../src/internal/platform/types.js";

function createMockCtx() {
  const disposers: Array<() => void> = [];
  return {
    logger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), level: 2 }) as any,
    on: vi.fn((_event: string, _handler: (...args: unknown[]) => void) => {
      const dispose = vi.fn();
      disposers.push(dispose);
      return dispose;
    }),
    middleware: vi.fn((_handler: Function, _prepend?: boolean) => {
      const dispose = vi.fn();
      disposers.push(dispose);
      return dispose;
    }),
    bots: [] as Bot[],
  } as any;
}

function createMockBot(platform: string): Bot {
  return {
    platform,
    selfId: `${platform}-self-001`,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("PlatformGateway", () => {
  let gateway: PlatformGateway;
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    mockCtx = createMockCtx();
    gateway = new PlatformGateway(mockCtx);
  });

  it("路由 send 到匹配的 PlatformAdapter", async () => {
    const mockAdapter: PlatformAdapter = {
      platform: "mock-platform",
      deliver: vi.fn().mockResolvedValue({
        ok: true,
        deliveredSegments: ["Hi"],
        failedSegments: [],
      }),
    };

    gateway.registerAdapter(mockAdapter);
    const bot = createMockBot("mock-platform");
    const result = await gateway.send(bot, "channel1", [["Hi"]] as Fragment[]);

    expect(mockAdapter.deliver).toHaveBeenCalledWith(bot, "channel1", [["Hi"]], undefined);
    expect(result.ok).toBe(true);
  });

  it("未注册 adapter 时 fallback 到 bot.sendMessage", async () => {
    const bot = createMockBot("unknown-platform");
    const result = await gateway.send(bot, "channel1", [["Hello"]] as Fragment[]);

    expect(bot.sendMessage).toHaveBeenCalledWith("channel1", ["Hello"]);
    expect(result.ok).toBe(true);
  });

  it("listener 返回 event 时发布 GatewayEvent", async () => {
    const subscriber = vi.fn().mockResolvedValue(undefined);
    gateway.subscribe(subscriber);

    const listener: PlatformListener = {
      name: "test.echo",
      eventType: "message",
      source: { kind: "middleware" },
      translate: vi.fn().mockReturnValue({
        type: "event",
        event: {
          id: "evt-1",
          type: "message",
          timestamp: 0,
          source: { platform: "test", channelId: "ch1", conversationType: "group" },
          actor: { id: "u1", name: "Alice" },
          content: [{ type: "text", text: "hi" }],
          visible: true,
          details: null,
          metadata: { persist: true, triggerCandidate: true },
        },
      }),
    };

    gateway.registerListener(listener);
    await gateway.start();

    // simulate middleware invocation
    const mockSession = {
      platform: "test",
      channelId: "ch1",
      userId: "u1",
      username: "Alice",
      bot: createMockBot("test"),
    };
    // 直接触发内部 handle — 需要找到注册的 middleware 回调
    const middlewareCall = mockCtx.middleware.mock.calls[0];
    const middlewareFn = middlewareCall[0];

    await middlewareFn(mockSession, vi.fn());

    expect(listener.translate).toHaveBeenCalled();
    expect(subscriber).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: "message" }),
        bot: mockSession.bot,
        originSession: mockSession,
      }),
    );
  });

  it("listener 返回 pass 时继续下一个 listener", async () => {
    const subscriber = vi.fn().mockResolvedValue(undefined);
    gateway.subscribe(subscriber);

    const passListener: PlatformListener = {
      name: "test.pass",
      eventType: "message",
      source: { kind: "middleware" },
      translate: vi.fn().mockReturnValue({ type: "pass" }),
    };

    const eventListener: PlatformListener = {
      name: "test.event",
      eventType: "message",
      source: { kind: "middleware" },
      priority: -1,
      translate: vi.fn().mockReturnValue({
        type: "event",
        event: {
          id: "evt-2",
          type: "message",
          timestamp: 0,
          source: { platform: "test", channelId: "ch1", conversationType: "group" },
          actor: { id: "u1", name: "Alice" },
          content: [{ type: "text", text: "hi" }],
          visible: true,
          details: null,
          metadata: { persist: true, triggerCandidate: true },
        },
      }),
    };

    gateway.registerListener(passListener);
    gateway.registerListener(eventListener);
    await gateway.start();

    const middlewareFn = mockCtx.middleware.mock.calls[0][0];
    await middlewareFn(
      { platform: "test", channelId: "ch1", userId: "u1", bot: createMockBot("test") },
      vi.fn(),
    );

    expect(passListener.translate).toHaveBeenCalled();
    expect(eventListener.translate).toHaveBeenCalled();
  });

  it("listener 返回 drop 时停止流转", async () => {
    const subscriber = vi.fn().mockResolvedValue(undefined);
    gateway.subscribe(subscriber);

    const dropListener: PlatformListener = {
      name: "test.drop",
      eventType: "message",
      source: { kind: "middleware" },
      translate: vi.fn().mockReturnValue({ type: "drop" }),
    };

    const neverCalled: PlatformListener = {
      name: "test.never",
      eventType: "message",
      source: { kind: "middleware" },
      priority: -1,
      translate: vi.fn(),
    };

    gateway.registerListener(dropListener);
    gateway.registerListener(neverCalled);
    await gateway.start();

    const middlewareFn = mockCtx.middleware.mock.calls[0][0];
    await middlewareFn(
      { platform: "test", channelId: "ch1", userId: "u1", bot: createMockBot("test") },
      vi.fn(),
    );

    expect(dropListener.translate).toHaveBeenCalled();
    expect(neverCalled.translate).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("send 失败时返回 DeliveryResult with issue", async () => {
    const bot = createMockBot("test");
    (bot.sendMessage as any).mockRejectedValue(new Error("Network error"));

    const result = await gateway.send(bot, "ch1", [["msg"]] as Fragment[]);

    expect(result.ok).toBe(false);
    expect(result.issue).toBeDefined();
    expect(result.issue!.kind).toBe("send_failed");
  });
});
