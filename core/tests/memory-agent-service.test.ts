import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class Service {
    ctx: Record<string, unknown>;
    config: unknown;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>, _name: string, _immediate?: boolean) {
      this.ctx = ctx;
      this.logger = (ctx.logger as (name: string) => Record<string, unknown>)("mock-service");
      this.config = {};
    }
  }

  return {
    Context: class {},
    Service,
  };
});

vi.mock("../src/services/memory-agent/agent", () => ({
  runMemoryExtraction: vi.fn(),
}));

vi.mock("../src/services/memory-agent/recall-plugin", () => ({
  MemoryRecallPlugin: class MemoryRecallPlugin {},
}));

import { runMemoryExtraction } from "../src/services/memory-agent/agent";
import { MemoryAgentService } from "../src/services/memory-agent/service";
import { MemoryScope, MemoryType } from "../src/services/memory-agent/types";

function createMockContext() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const intervals: Array<() => Promise<void> | void> = [];
  const fragmentSources = new Map<string, (scope: Record<string, unknown>) => unknown>();

  const queryChain = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  };

  const ctx: Record<string, unknown> = {
    logger: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    model: {
      extend: vi.fn(),
    },
    database: {
      select: vi.fn(() => queryChain),
    },
    setInterval: vi.fn((fn: () => Promise<void> | void) => {
      intervals.push(fn);
      return vi.fn();
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
    plugin: vi.fn(),
    "yesimbot.prompt": {
      inject: vi.fn(),
      registerFragmentSource: vi.fn(
        (name: string, provider: (scope: Record<string, unknown>) => unknown) => {
          fragmentSources.set(name, provider);
          return vi.fn();
        },
      ),
    },
  };

  return { ctx, handlers, intervals, fragmentSources };
}

function createConfig() {
  return {
    memoryAgent: {
      compressionThreshold: 80,
      compressionIntervalMs: 12345,
      inactivityTriggerMs: 1800000,
      coreMemoryBudget: 2000,
      summaryModel: "openai:gpt-4o-mini",
      maxAgentSteps: 15,
      retainRecentEntries: 10,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("MemoryAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules periodic checks and runs extraction for active channels", async () => {
    const { ctx, intervals } = createMockContext();
    const service = new MemoryAgentService(ctx as never, createConfig());

    const channels = [
      { platform: "discord", channelId: "c1" },
      { platform: "discord", channelId: "c2" },
    ];
    const getActiveChannelsSpy = vi
      .spyOn(service as never, "getActiveChannels")
      .mockResolvedValue(channels);
    const maybeRunAgentSpy = vi
      .spyOn(service as never, "maybeRunAgent")
      .mockResolvedValue(undefined);

    await (service as never).start();
    expect(ctx.setInterval).toHaveBeenCalledTimes(1);
    expect(ctx.setInterval).toHaveBeenCalledWith(expect.any(Function), 12345);

    await intervals[0]();

    expect(getActiveChannelsSpy).toHaveBeenCalledTimes(1);
    expect(maybeRunAgentSpy).toHaveBeenCalledTimes(2);
    expect(maybeRunAgentSpy).toHaveBeenNthCalledWith(1, channels[0]);
    expect(maybeRunAgentSpy).toHaveBeenNthCalledWith(2, channels[1]);
  });

  it("reacts to athena:timeline.compressed by triggering channel extraction", async () => {
    const { ctx, handlers } = createMockContext();
    const service = new MemoryAgentService(ctx as never, createConfig());

    const maybeRunAgentSpy = vi
      .spyOn(service as never, "maybeRunAgent")
      .mockResolvedValue(undefined);

    await (service as never).start();

    const handler = handlers.get("athena:timeline.compressed");
    expect(handler).toBeTypeOf("function");

    await handler?.({ platform: "discord", channelId: "trigger-channel" });

    expect(maybeRunAgentSpy).toHaveBeenCalledTimes(1);
    expect(maybeRunAgentSpy).toHaveBeenCalledWith({
      platform: "discord",
      channelId: "trigger-channel",
    });
  });

  it("prevents concurrent extraction per channel via in-progress lock", async () => {
    const { ctx } = createMockContext();
    const service = new MemoryAgentService(ctx as never, createConfig());
    const extraction = deferred<void>();
    const runMock = vi.mocked(runMemoryExtraction);
    runMock.mockReturnValue(extraction.promise);

    const channelKey = { platform: "discord", channelId: "lock-channel" };

    const first = service.maybeRunAgent(channelKey);
    const second = service.maybeRunAgent(channelKey);

    expect(runMock).toHaveBeenCalledTimes(1);

    extraction.resolve();
    await Promise.all([first, second]);

    await service.maybeRunAgent(channelKey);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it("registers canonical memory.core fragment source instead of extra injection", async () => {
    const { ctx, fragmentSources } = createMockContext();
    const service = new MemoryAgentService(ctx as never, createConfig());

    (
      service as unknown as {
        getCoreMemories: ReturnType<typeof vi.fn>;
      }
    ).getCoreMemories = vi.fn().mockResolvedValue([
      {
        id: "m1",
        type: MemoryType.Profile,
        scope: MemoryScope.Channel,
        scopeId: "discord:test-channel",
        platform: "discord",
        content: "User prefers concise replies",
        importance: 80,
        isCore: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await (service as unknown as { start: () => Promise<void> }).start();

    const promptService = ctx["yesimbot.prompt"] as {
      inject: ReturnType<typeof vi.fn>;
      registerFragmentSource: ReturnType<typeof vi.fn>;
    };

    expect(promptService.inject).not.toHaveBeenCalled();
    expect(promptService.registerFragmentSource).toHaveBeenCalled();

    const provider = fragmentSources.get("memory");
    expect(provider).toBeTypeOf("function");

    const fragments = (await provider?.({
      view: {
        environment: {
          platform: "discord",
          channelId: "test-channel",
        },
      },
    })) as Array<{ id: string; section: string; stability: string; content: string }>;

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      id: "memory.core",
      section: "memory",
      stability: "stable",
    });
    expect(fragments[0].content).toContain("<core_memories>");
    expect(fragments[0].content).toContain("User prefers concise replies");
  });
});
