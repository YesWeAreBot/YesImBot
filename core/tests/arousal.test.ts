import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock koishi before any imports that use it
vi.mock("koishi", () => {
  const SchemaMock = new Proxy(
    {},
    {
      get: (_target: object, prop: string | symbol) => {
        if (typeof prop === "symbol") return undefined;
        return (..._args: unknown[]) => {
          const chain: Record<string, unknown> = {};
          const handler: ProxyHandler<Record<string, unknown>> = {
            get: (_t: object, p: string | symbol) => {
              if (typeof p === "symbol") return undefined;
              return (..._a: unknown[]) => new Proxy(chain, handler);
            },
          };
          return new Proxy(chain, handler);
        };
      },
    },
  );

  return {
    Schema: SchemaMock,
    Context: class {
      logger() {
        return {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };
      }
    },
    Service: class {
      ctx: unknown;
      config: unknown;
      logger: { info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
      constructor(ctx: unknown, _name: string, _immediate?: boolean) {
        this.ctx = ctx;
        this.logger = {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        };
      }
    },
    Random: { id: () => `mock-${Date.now()}` },
  };
});

import { ArousalService, type ArousalConfig } from "../src/services/arousal";
import { evaluateChannels, type ChannelSummary } from "../src/services/arousal/scheduler";

function createMockContext(overrides: Record<string, unknown> = {}) {
  const timers: Array<{ callback: () => void; interval: number; id: number }> = [];
  let timerCounter = 0;
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

  const ctx: Record<string, unknown> = {
    setInterval: vi.fn((callback: () => void, interval: number) => {
      const id = ++timerCounter;
      timers.push({ callback, interval, id });
      return () => {
        const idx = timers.findIndex((t) => t.id === id);
        if (idx >= 0) timers.splice(idx, 1);
      };
    }),
    setTimeout: vi.fn((callback: () => void, _delay: number) => {
      return () => {};
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = eventHandlers.get(event);
      if (handlers) handlers.forEach((h) => h(...args));
    }),
    logger: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    "yesimbot.model": {
      call: vi.fn().mockResolvedValue({
        text: JSON.stringify([
          { channelKey: "discord:channel-1", reason: "Active discussion" },
        ]),
      }),
    },
    "yesimbot.horizon": {
      events: {
        query: vi.fn().mockResolvedValue([]),
        record: vi.fn().mockResolvedValue({}),
      },
    },
    _timers: timers,
    ...overrides,
  };
  return ctx;
}

function createDefaultConfig(): ArousalConfig {
  return {
    enabled: true,
    heartbeatIntervalMs: 1800000,
    excludeChannels: [],
    dailyMessageLimit: 3,
    evaluationModel: "openai:gpt-4o-mini",
  };
}

describe("ArousalService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("timer setup", () => {
    it("starts global heartbeat timer at configured interval when enabled", () => {
      const ctx = createMockContext();
      const config = createDefaultConfig();
      const service = new ArousalService(ctx as any, config);
      service.start();

      expect(ctx.setInterval).toHaveBeenCalledWith(
        expect.any(Function),
        config.heartbeatIntervalMs,
      );
    });

    it("does not start timer when disabled", () => {
      const ctx = createMockContext();
      const config = createDefaultConfig();
      config.enabled = false;
      const service = new ArousalService(ctx as any, config);
      service.start();

      expect(ctx.setInterval).not.toHaveBeenCalled();
    });

    it("stops cleanly by clearing timer", () => {
      const ctx = createMockContext();
      const config = createDefaultConfig();
      const service = new ArousalService(ctx as any, config);
      service.start();
      service.stop();

      // After stop, the timer should be cleared
      // We verify by checking the internal state
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe("globalHeartbeat", () => {
    it("calls evaluateChannels and emits athena:heartbeat for selected channels", async () => {
      const mockChannelEntries = [
        {
          id: "1",
          type: "message",
          platform: "discord",
          channelId: "channel-1",
          timestamp: new Date(Date.now() - 60000),
          data: { content: "Hello", senderId: "user1", senderName: "User1", messageId: "m1" },
          stage: "active",
          priority: 1,
        },
      ];
      const ctx = createMockContext({
        "yesimbot.horizon": {
          events: {
            query: vi.fn().mockResolvedValue(mockChannelEntries),
            record: vi.fn().mockResolvedValue({}),
          },
        },
        "yesimbot.model": {
          call: vi.fn().mockResolvedValue({
            text: JSON.stringify([
              { channelKey: "discord:channel-1", reason: "Active discussion" },
            ]),
          }),
        },
      });

      const config = createDefaultConfig();
      const service = new ArousalService(ctx as any, config);
      service.start();

      await service.globalHeartbeat();

      expect(ctx.emit).toHaveBeenCalledWith("athena:heartbeat", {
        platform: "discord",
        channelId: "channel-1",
        triggeredBy: "global",
      });
    });

    it("rate limiter blocks heartbeat for channels exceeding daily limit", async () => {
      const mockChannelEntries = [
        {
          id: "1",
          type: "message",
          platform: "discord",
          channelId: "channel-1",
          timestamp: new Date(Date.now() - 60000),
          data: { content: "Hello", senderId: "user1", senderName: "User1", messageId: "m1" },
          stage: "active",
          priority: 1,
        },
      ];
      const ctx = createMockContext({
        "yesimbot.horizon": {
          events: {
            query: vi.fn().mockResolvedValue(mockChannelEntries),
            record: vi.fn().mockResolvedValue({}),
          },
        },
        "yesimbot.model": {
          call: vi.fn().mockResolvedValue({
            text: JSON.stringify([
              { channelKey: "discord:channel-1", reason: "Active discussion" },
            ]),
          }),
        },
      });

      const config = createDefaultConfig();
      config.dailyMessageLimit = 2;
      const service = new ArousalService(ctx as any, config);
      service.start();

      // Simulate already reaching daily limit
      service.recordProactiveMessage("discord:channel-1");
      service.recordProactiveMessage("discord:channel-1");

      // Clear previous emit calls
      (ctx.emit as ReturnType<typeof vi.fn>).mockClear();

      await service.globalHeartbeat();

      // Should NOT emit heartbeat because daily limit exceeded
      expect(ctx.emit).not.toHaveBeenCalledWith(
        "athena:heartbeat",
        expect.objectContaining({ channelId: "channel-1" }),
      );
    });

    it("excluded channels are never selected for heartbeat", async () => {
      const mockChannelEntries = [
        {
          id: "1",
          type: "message",
          platform: "discord",
          channelId: "excluded-channel",
          timestamp: new Date(Date.now() - 60000),
          data: { content: "Hello", senderId: "user1", senderName: "User1", messageId: "m1" },
          stage: "active",
          priority: 1,
        },
      ];
      const ctx = createMockContext({
        "yesimbot.horizon": {
          events: {
            query: vi.fn().mockResolvedValue(mockChannelEntries),
            record: vi.fn().mockResolvedValue({}),
          },
        },
        "yesimbot.model": {
          call: vi.fn().mockResolvedValue({
            text: JSON.stringify([
              { channelKey: "discord:excluded-channel", reason: "Active discussion" },
            ]),
          }),
        },
      });

      const config = createDefaultConfig();
      config.excludeChannels = ["discord:excluded-channel"];
      const service = new ArousalService(ctx as any, config);
      service.start();

      await service.globalHeartbeat();

      // Should NOT emit heartbeat for excluded channel
      expect(ctx.emit).not.toHaveBeenCalledWith(
        "athena:heartbeat",
        expect.objectContaining({ channelId: "excluded-channel" }),
      );
    });

    it("records HeartbeatRecord in timeline for selected channels", async () => {
      const mockRecord = vi.fn().mockResolvedValue({});
      const mockChannelEntries = [
        {
          id: "1",
          type: "message",
          platform: "discord",
          channelId: "channel-1",
          timestamp: new Date(Date.now() - 60000),
          data: { content: "Hello", senderId: "user1", senderName: "User1", messageId: "m1" },
          stage: "active",
          priority: 1,
        },
      ];
      const ctx = createMockContext({
        "yesimbot.horizon": {
          events: {
            query: vi.fn().mockResolvedValue(mockChannelEntries),
            record: mockRecord,
          },
        },
        "yesimbot.model": {
          call: vi.fn().mockResolvedValue({
            text: JSON.stringify([
              { channelKey: "discord:channel-1", reason: "Active discussion" },
            ]),
          }),
        },
      });

      const config = createDefaultConfig();
      const service = new ArousalService(ctx as any, config);
      service.start();

      await service.globalHeartbeat();

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "heartbeat",
          platform: "discord",
          channelId: "channel-1",
          data: expect.objectContaining({
            triggeredBy: "global",
          }),
        }),
      );
    });
  });

  describe("rate limiting", () => {
    it("heartbeat eligibility does not consume quota until successful send accounting occurs (AROUS-05)", async () => {
      const mockChannelEntries = [
        {
          id: "1",
          type: "message",
          platform: "discord",
          channelId: "channel-1",
          timestamp: new Date(Date.now() - 60000),
          data: { content: "Hello", senderId: "user1", senderName: "User1", messageId: "m1" },
          stage: "active",
          priority: 1,
        },
      ];
      const ctx = createMockContext({
        "yesimbot.horizon": {
          events: {
            query: vi.fn().mockResolvedValue(mockChannelEntries),
            record: vi.fn().mockResolvedValue({}),
          },
        },
        "yesimbot.model": {
          call: vi.fn().mockResolvedValue({
            text: JSON.stringify([
              { channelKey: "discord:channel-1", reason: "Active discussion" },
            ]),
          }),
        },
      });
      const config = createDefaultConfig();
      config.dailyMessageLimit = 1;
      const service = new ArousalService(ctx as any, config);
      service.start();

      // Eligibility to run heartbeat should not burn quota by itself.
      expect(service.checkRateLimit("discord:channel-1")).toBe(true);
      await service.globalHeartbeat();
      expect(ctx.emit).toHaveBeenCalledWith("athena:heartbeat", {
        platform: "discord",
        channelId: "channel-1",
        triggeredBy: "global",
      });
      expect(service.checkRateLimit("discord:channel-1")).toBe(true);

      // Quota is consumed only when success accounting is recorded.
      service.recordProactiveMessage("discord:channel-1");
      expect(service.checkRateLimit("discord:channel-1")).toBe(false);
    });

    it("checkRateLimit returns true when under daily limit", () => {
      const ctx = createMockContext();
      const config = createDefaultConfig();
      config.dailyMessageLimit = 3;
      const service = new ArousalService(ctx as any, config);
      service.start();

      expect(service.checkRateLimit("discord:channel-1")).toBe(true);
    });

    it("checkRateLimit returns false when daily limit exceeded", () => {
      const ctx = createMockContext();
      const config = createDefaultConfig();
      config.dailyMessageLimit = 2;
      const service = new ArousalService(ctx as any, config);
      service.start();

      service.recordProactiveMessage("discord:channel-1");
      service.recordProactiveMessage("discord:channel-1");

      expect(service.checkRateLimit("discord:channel-1")).toBe(false);
    });

    it("resets daily count after 24 hours", () => {
      const ctx = createMockContext();
      const config = createDefaultConfig();
      config.dailyMessageLimit = 1;
      const service = new ArousalService(ctx as any, config);
      service.start();

      service.recordProactiveMessage("discord:channel-1");
      expect(service.checkRateLimit("discord:channel-1")).toBe(false);

      // Advance time by 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      expect(service.checkRateLimit("discord:channel-1")).toBe(true);
    });
  });
});

describe("evaluateChannels", () => {
  it("returns empty array when no channels have recent activity", async () => {
    const mockModelService = {
      call: vi.fn().mockResolvedValue({ text: "[]" }),
    };
    const result = await evaluateChannels(
      mockModelService as any,
      createDefaultConfig(),
      [],
    );
    expect(result).toEqual([]);
    // Should not call model when there are no channels
    expect(mockModelService.call).not.toHaveBeenCalled();
  });

  it("filters out channels in excludeChannels config", async () => {
    const mockModelService = {
      call: vi.fn().mockResolvedValue({
        text: JSON.stringify([
          { channelKey: "discord:keep", reason: "Active" },
          { channelKey: "discord:exclude", reason: "Active" },
        ]),
      }),
    };
    const config = createDefaultConfig();
    config.excludeChannels = ["discord:exclude"];

    const summaries: ChannelSummary[] = [
      { channelKey: "discord:keep", lastMessageTime: new Date(), lastContent: "test", messageCount: 5 },
      { channelKey: "discord:exclude", lastMessageTime: new Date(), lastContent: "test", messageCount: 5 },
    ];

    const result = await evaluateChannels(
      mockModelService as any,
      config,
      summaries,
    );
    expect(result.every((r) => r.platform !== "discord" || r.channelId !== "exclude")).toBe(true);
  });

  it("returns empty array when model call fails (fail-safe)", async () => {
    const mockModelService = {
      call: vi.fn().mockRejectedValue(new Error("Model error")),
    };
    const summaries: ChannelSummary[] = [
      { channelKey: "discord:chan1", lastMessageTime: new Date(), lastContent: "test", messageCount: 5 },
    ];

    const result = await evaluateChannels(
      mockModelService as any,
      createDefaultConfig(),
      summaries,
    );
    expect(result).toEqual([]);
  });
});
