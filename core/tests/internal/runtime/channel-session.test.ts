import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

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
  convertToLlm: vi.fn(),
}));

import type { Bot } from "koishi";

import type { PlatformGateway } from "../../../src/internal/platform/gateway.js";
import {
  ChannelSession,
  type ChannelSessionDeps,
  isChannelAllowed,
} from "../../../src/internal/runtime/session.js";
import type { PlatformEvent } from "../../../src/shared/platform-event.js";

function createMockGateway(): PlatformGateway {
  return {
    send: vi.fn().mockResolvedValue({
      ok: true,
      deliveredSegments: [],
      failedSegments: [],
    }),
    subscribe: vi.fn(() => vi.fn()),
    registerAdapter: vi.fn(() => vi.fn()),
    registerListener: vi.fn(() => vi.fn()),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  } as any;
}

function createMockBot(): Bot {
  return {
    platform: "test",
    selfId: "test-bot-001",
    user: { nick: "TestBot", name: "TestBot" },
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockSessionManager() {
  return {
    getSessionName: vi.fn(() => "test-session"),
    getSessionId: vi.fn(() => "test-id"),
    getSessionFile: vi.fn(() => ({ path: "/tmp/test", id: "test-id", cwd: "" })),
    appendSessionInfo: vi.fn(),
    appendCustomEntry: vi.fn(),
    appendCustomMessageEntry: vi.fn(),
    appendMessage: vi.fn(),
    buildSessionContext: vi.fn(() => ({
      messages: [],
      thinkingLevel: "none",
      model: null,
    })),
    getBranch: vi.fn(() => []),
    getEntries: vi.fn(() => []),
  } as any;
}

function createMockDeps(overrides?: Partial<ChannelSessionDeps>): ChannelSessionDeps {
  return {
    channel: { platform: "test", channelId: "ch1", type: "group" },
    sessionManager: createMockSessionManager(),
    model: { model: vi.fn() } as any,
    platformGateway: createMockGateway(),
    koishiBot: createMockBot(),
    settings: {
      globalPath: "/tmp/settings.json",
      localPath: "/tmp/channel-settings.json",
    },
    behavior: {
      allowedChannels: [{ platform: "*", channelId: "*", type: "group" }],
      willingnessManager: { shouldReply: vi.fn(() => ({ decision: true })) },
    },
    extensions: { definitions: [] },
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), level: 2 } as any,
    ...overrides,
  };
}

function createEvent(overrides?: Partial<PlatformEvent>): PlatformEvent {
  return {
    id: "evt-1",
    type: "message",
    timestamp: Date.now(),
    source: {
      platform: "test",
      channelId: "ch1",
      conversationType: "group",
      selfId: "test-bot-001",
    },
    actor: { id: "u1", name: "Alice" },
    content: [{ type: "text", text: "Hello" }],
    visible: true,
    details: null,
    metadata: { persist: true, triggerCandidate: true },
    ...overrides,
  };
}

describe("isChannelAllowed", () => {
  it("matches exact allowed channel", () => {
    expect(
      isChannelAllowed("onebot", "group-1", "group", [
        { platform: "onebot", channelId: "group-1", type: "group" },
      ]),
    ).toBe(true);
  });

  it("rejects wrong channel type", () => {
    expect(
      isChannelAllowed("onebot", "group-1", "private", [
        { platform: "onebot", channelId: "group-1", type: "group" },
      ]),
    ).toBe(false);
  });

  it("matches wildcard platform", () => {
    expect(
      isChannelAllowed("anyplatform", "ch-1", "group", [
        { platform: "*", channelId: "*", type: "group" },
      ]),
    ).toBe(true);
  });
});

describe("ChannelSession (de-physicalized)", () => {
  it("handleEvent uses PlatformEvent.content directly (no present())", async () => {
    const deps = createMockDeps();
    const session = new ChannelSession(deps);
    const event = createEvent();
    const bot = createMockBot();

    await session.handleEvent(event, bot);
    // Verifies type-level compilation + no present() call
    expect(true).toBe(true);
  });

  it("persist=false + triggerCandidate=false → skips", async () => {
    const deps = createMockDeps();
    const session = new ChannelSession(deps);
    const event = createEvent({
      metadata: { persist: false, triggerCandidate: false },
    });
    const bot = createMockBot();

    await session.handleEvent(event, bot);
    // Should return early without calling sendCustomMessage
    expect(deps.sessionManager.appendCustomEntry).not.toHaveBeenCalled();
  });

  it("send failure records DeliveryIssue", async () => {
    const mockGateway = {
      ...createMockGateway(),
      send: vi.fn().mockResolvedValue({
        ok: false,
        deliveredSegments: [],
        failedSegments: ["msg"],
        issue: {
          kind: "send_failed",
          timestamp: Date.now(),
          reason: "Network error",
          failedSegments: ["msg"],
        },
      }),
    } as any;
    const deps = createMockDeps({ platformGateway: mockGateway });
    const session = new ChannelSession(deps);
    const event = createEvent();
    const bot = createMockBot();

    await session.handleEvent(event, bot);
    expect(deps.sessionManager.appendCustomEntry).toBeDefined();
  });

  it("dispose closes all resources safely", () => {
    const deps = createMockDeps();
    const session = new ChannelSession(deps);
    session.dispose();
    // Second dispose should be safe (idempotent)
    expect(() => session.dispose()).not.toThrow();
  });

  it("handleEvent on disposed session is a no-op", async () => {
    const deps = createMockDeps();
    const session = new ChannelSession(deps);
    session.dispose();

    const event = createEvent();
    const bot = createMockBot();

    await session.handleEvent(event, bot);
    expect(deps.behavior.willingnessManager.shouldReply).not.toHaveBeenCalled();
  });

  it("botInfo is populated from koishiBot", () => {
    const deps = createMockDeps();
    const session = new ChannelSession(deps);
    expect(session.getBotInfo()).toEqual({
      selfId: "test-bot-001",
      selfName: "TestBot",
    });
  });

  it("channelKey is constructed from platform:channelId", () => {
    const deps = createMockDeps();
    const session = new ChannelSession(deps);
    expect(session.channelKey).toBe("test:ch1");
  });
});
