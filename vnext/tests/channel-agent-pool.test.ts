import { join } from "node:path";

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  continueRecentSpy,
  createSpy,
  createSettingsSpy,
  createAgentSessionSpy,
  resourceLoaderCtorSpy,
  createExtensionRuntimeSpy,
} = vi.hoisted(() => ({
  continueRecentSpy: vi.fn(),
  createSpy: vi.fn(),
  createSettingsSpy: vi.fn(),
  createAgentSessionSpy: vi.fn(),
  resourceLoaderCtorSpy: vi.fn(),
  createExtensionRuntimeSpy: vi.fn(() => ({
    registerHook: vi.fn(),
    getToolDefinitions: vi.fn(() => []),
  })),
}));

vi.mock("koishi", () => {
  class MockContext {
    [key: string]: unknown;
    baseDir = "/workspace/project";

    logger(_name: string) {
      return { level: 0, debug: vi.fn() };
    }
  }

  class MockService<TConfig> {
    public readonly ctx: Record<string, unknown>;
    public config!: TConfig;
    public logger: { level?: number } = {};

    constructor(ctx: Record<string, unknown>, serviceId: string) {
      this.ctx = ctx;
      ctx[serviceId] = this;
    }
  }

  return {
    Context: MockContext,
    Service: MockService,
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  SessionManager: {
    continueRecent: continueRecentSpy,
    create: createSpy,
  },
  SettingsManager: {
    create: createSettingsSpy,
  },
  createAgentSession: createAgentSessionSpy,
  createExtensionRuntime: createExtensionRuntimeSpy,
}));

vi.mock("../src/services/session/prompt/resource-loader", () => ({
  AthenaResourceLoader: class MockAthenaResourceLoader {
    constructor(config: { soulDir: string }) {
      resourceLoaderCtorSpy(config);
    }
  },
}));

import { Context } from "koishi";

import type { ModelsService } from "../src/services/models/service";
import { SessionService } from "../src/services/session/service";

function createTestSession(label: string): AgentSession {
  return {
    __label: label,
    subscribe: vi.fn(() => vi.fn()),
    agent: {
      appendMessage: vi.fn(),
    },
  } as unknown as AgentSession;
}

function createService() {
  const ctx = new Context() as Context & {
    baseDir: string;
    [key: string]: unknown;
  };
  ctx.baseDir = "/workspace/project";
  ctx["athena.models"] = {
    authStorage: {} as AuthStorage,
    modelRegistry: {} as ModelRegistry,
  } as unknown as ModelsService;

  const athenaDir = join(ctx.baseDir, ".athena");
  const service = new SessionService(ctx, {
    athenaDir,
    triggerKeywords: [],
    cooldownMs: 1000,
    maxMessageLength: 4000,
  });

  return { ctx, service, athenaDir };
}

describe("SessionService", () => {
  beforeEach(() => {
    continueRecentSpy.mockReset();
    createSpy.mockReset();
    createSettingsSpy.mockReset();
    createAgentSessionSpy.mockReset();
    resourceLoaderCtorSpy.mockReset();
    createExtensionRuntimeSpy.mockClear();

    continueRecentSpy.mockImplementation((_cwd: string, sessionDir: string) => ({
      kind: "continueRecent",
      sessionDir,
    }));
    createSpy.mockImplementation((_cwd: string, sessionDir: string) => ({
      kind: "create",
      sessionDir,
    }));
    createSettingsSpy.mockImplementation((cwd: string, sessionDir: string) => ({
      kind: "settings",
      cwd,
      sessionDir,
    }));

    createAgentSessionSpy.mockImplementation(async (options: unknown) => ({
      session: createTestSession(String((options as { cwd?: string }).cwd ?? "unknown")),
      extensionsResult: {
        extensions: [],
        errors: [],
        runtime: createExtensionRuntimeSpy(),
      },
    }));
  });

  it("receive creates and routes through an AgentSession", async () => {
    const { service } = createService();

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot ping",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });

    const session = service.get("discord", "123");
    expect(session).toBeDefined();
  });

  it("repeated receive for same channel reuses same session", async () => {
    const { service } = createService();

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot first",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });
    const first = service.get("discord", "123");

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot second",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m2",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });
    const second = service.get("discord", "123");

    expect(second).toBe(first);
  });

  it("concurrent receive for same channel uses promise lock", async () => {
    const { service } = createService();

    const [first, second] = await Promise.all([
      service.receive({
        platform: "discord",
        channelId: "123",
        userId: "u1",
        username: "Alice",
        content: "@bot one",
        isDirect: false,
        atSelf: true,
        isReplyToBot: false,
        messageId: "m1",
        timestamp: Date.now(),
        elements: [],
        bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
      }),
      service.receive({
        platform: "discord",
        channelId: "123",
        userId: "u2",
        username: "Bob",
        content: "@bot two",
        isDirect: false,
        atSelf: true,
        isReplyToBot: false,
        messageId: "m2",
        timestamp: Date.now(),
        elements: [],
        bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
      }),
    ]);

    expect(second).toBeUndefined();
    expect(first).toBeUndefined();
    expect(createAgentSessionSpy).toHaveBeenCalledTimes(1);
  });

  it("different channels create different session instances", async () => {
    const { service } = createService();
    createAgentSessionSpy
      .mockResolvedValueOnce({
        session: createTestSession("s1"),
        extensionsResult: {
          extensions: [],
          errors: [],
          runtime: createExtensionRuntimeSpy(),
        },
      })
      .mockResolvedValueOnce({
        session: createTestSession("s2"),
        extensionsResult: {
          extensions: [],
          errors: [],
          runtime: createExtensionRuntimeSpy(),
        },
      });

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot one",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });
    await service.receive({
      platform: "discord",
      channelId: "456",
      userId: "u2",
      username: "Bob",
      content: "@bot two",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m2",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });

    const first = service.get("discord", "123");
    const second = service.get("discord", "456");

    expect(second).not.toBe(first);
  });

  it("get returns undefined before receive and same session after receive", async () => {
    const { service } = createService();

    expect(service.get("discord", "123")).toBeUndefined();

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot ping",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });
    const created = service.get("discord", "123");

    expect(service.get("discord", "123")).toBe(created);
  });

  it("delete removes entry and returns true when entry existed", async () => {
    const { service } = createService();

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot ping",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });
    const deleted = service.delete("discord", "123");

    expect(deleted).toBe(true);
    expect(service.get("discord", "123")).toBeUndefined();
  });

  it("passes project cwd and explicit sessionDir to SessionManager.continueRecent", async () => {
    const { service, athenaDir } = createService();
    const projectCwd = join(athenaDir, "projects");

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot ping",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });

    expect(continueRecentSpy).toHaveBeenCalledWith(
      projectCwd,
      join(athenaDir, "sessions", "discord:123"),
    );
    expect(createSettingsSpy).toHaveBeenCalledWith(
      projectCwd,
      join(athenaDir, "sessions", "discord:123"),
    );
  });

  it("falls back to SessionManager.create when continueRecent throws", async () => {
    const { service, athenaDir } = createService();
    const projectCwd = join(athenaDir, "projects");
    continueRecentSpy.mockImplementation(() => {
      throw new Error("restore failed");
    });

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot ping",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });

    expect(createSpy).toHaveBeenCalledWith(projectCwd, join(athenaDir, "sessions", "discord:123"));
  });

  it("constructs AthenaResourceLoader with .athena/soul", async () => {
    const { service, athenaDir } = createService();

    await service.receive({
      platform: "discord",
      channelId: "123",
      userId: "u1",
      username: "Alice",
      content: "@bot ping",
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: Date.now(),
      elements: [],
      bot: { selfId: "bot-1", sendMessage: vi.fn().mockResolvedValue(undefined) } as never,
    });

    expect(resourceLoaderCtorSpy).toHaveBeenCalledWith({
      soulDir: join(athenaDir, "soul"),
    });
  });
});
