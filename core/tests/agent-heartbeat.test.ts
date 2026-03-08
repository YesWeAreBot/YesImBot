import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class Service {
    ctx: Record<string, unknown>;
    config: unknown;
    logger: Record<string, unknown>;

    constructor(ctx: Record<string, unknown>, _name: string, _immediate?: boolean) {
      this.ctx = ctx;
      this.config = {};
      this.logger = (ctx.logger as (name: string) => Record<string, unknown>)("mock-agent");
    }
  }

  return {
    Context: class {},
    Service,
    Random: { id: () => "mock-rand" },
  };
});

vi.mock("../src/services/agent/loop", () => ({
  ThinkActLoop: class ThinkActLoop {
    run = vi.fn().mockResolvedValue({ totalTokens: 0, totalToolCalls: 0 });
  },
}));

vi.mock("../src/services/agent/willingness", () => ({
  TokenBucket: class TokenBucket {
    consume() {
      return true;
    }
  },
  WillingnessEngine: class WillingnessEngine {
    tick() {}
    processMessage() {
      return {
        probability: 1,
        shouldReply: true,
        debug: {
          prevWillingness: 0,
          newWillingness: 1,
          gain: 1,
          keywordHit: false,
          fatigue: 1,
          triggerType: "mention",
        },
      };
    }
    recordBotReply() {}
  },
  WillingnessSchema: {},
}));

import { AgentCore } from "../src/services/agent/service";

function createMockContext() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const ctx: Record<string, unknown> = {
    logger: vi.fn(() => ({
      level: 2,
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    command: vi.fn(() => ({})),
    setInterval: vi.fn(() => vi.fn()),
    setTimeout: vi.fn(() => vi.fn()),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
    bots: [],
  };

  return { ctx, handlers };
}

describe("AgentCore heartbeat integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["global", "manual"] as const)(
    "wires athena:heartbeat and enqueues an internal payload with heartbeat metadata (%s)",
    async (triggeredBy) => {
      const { ctx, handlers } = createMockContext();
      const service = new AgentCore(ctx as never, {});

      const enqueueSpy = vi
        .spyOn(service as never, "enqueue")
        .mockImplementation(() => undefined);

      await (service as never).start();

      expect(ctx.on).toHaveBeenCalledWith("athena:heartbeat", expect.any(Function));

      const handler = handlers.get("athena:heartbeat");
      expect(handler).toBeTypeOf("function");

      handler?.({
        platform: "discord",
        channelId: "heartbeat-room",
        triggeredBy,
      });

      expect(enqueueSpy).toHaveBeenCalledTimes(1);

      const [channelKey, payload] = enqueueSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(channelKey).toBe("discord:heartbeat-room");
      expect(payload.toolCtx).toMatchObject({
        platform: "discord",
        channelId: "heartbeat-room",
      });

      const percept = payload.percept as Record<string, unknown>;
      expect(percept.type).toBe("internal");
      expect(percept.platform).toBe("discord");
      expect(percept.channelId).toBe("heartbeat-room");
      expect(percept.metadata).toMatchObject({
        isHeartbeat: true,
        triggeredBy,
      });
    },
  );
});
