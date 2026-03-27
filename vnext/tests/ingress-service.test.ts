import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class MockContext {
    [key: string]: unknown;

    logger(_name: string) {
      return { level: 0, debug: vi.fn() };
    }

    on(_event: string, _listener: (session: unknown) => void) {
      return () => {};
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

import { Context } from "koishi";

import { ListenerService } from "../src/services/listener/service";

interface StubKoishiSession {
  platform: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  isDirect: boolean;
  stripped: {
    atSelf: boolean;
    hasAt: boolean;
  };
  elements: Array<{
    type: string;
    attrs: Record<string, string>;
  }>;
  messageId: string;
  timestamp: number;
  selfId: string;
  quote?: {
    user?: {
      id?: string;
    };
  };
  bot: Record<string, unknown>;
}

function createService() {
  const receive = vi.fn().mockResolvedValue(undefined);

  const ctx = new Context() as Context & {
    [key: string]: unknown;
  };
  ctx["athena.session"] = { receive } as unknown as Context["athena.session"];

  const service = new ListenerService(ctx, {
    debugLevel: 0,
  });

  return {
    service,
    receive,
  };
}

describe("listener service", () => {
  it("extracts group message session fields and routes to session.receive", async () => {
    const { service, receive } = createService();

    const groupSession: StubKoishiSession = {
      platform: "discord",
      channelId: "c1",
      userId: "u123",
      username: "Alice",
      content: "hello",
      isDirect: false,
      stripped: { atSelf: false, hasAt: false },
      elements: [
        {
          type: "img",
          attrs: {
            src: "https://example.com/pic.png",
            mime: "image/png",
          },
        },
      ],
      messageId: "m1",
      timestamp: new Date(2024, 2, 22, 23, 18).getTime(),
      selfId: "bot-1",
      quote: undefined,
      bot: {},
    };

    await (
      service as unknown as {
        handleMessage: (koishiSession: StubKoishiSession) => Promise<void>;
      }
    ).handleMessage(groupSession);

    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith({
      platform: "discord",
      channelId: "c1",
      userId: "u123",
      username: "Alice",
      content: "hello",
      isDirect: false,
      atSelf: false,
      isReplyToBot: false,
      messageId: "m1",
      timestamp: new Date(2024, 2, 22, 23, 18).getTime(),
      elements: [
        {
          type: "img",
          attrs: {
            src: "https://example.com/pic.png",
            mime: "image/png",
          },
        },
      ],
      bot: {},
    });
  });

  it("computes atSelf from at element mention and routes event", async () => {
    const { service, receive } = createService();

    const directSession: StubKoishiSession = {
      platform: "discord",
      channelId: "c1",
      userId: "u456",
      username: "Bob",
      content: "show this",
      isDirect: true,
      stripped: { atSelf: false, hasAt: true },
      elements: [
        {
          type: "at",
          attrs: {
            id: "bot-1",
          },
        },
      ],
      messageId: "dm-1",
      timestamp: new Date(2024, 2, 22, 23, 18).getTime(),
      selfId: "bot-1",
      quote: undefined,
      bot: {},
    };

    await (
      service as unknown as {
        handleMessage: (koishiSession: StubKoishiSession) => Promise<void>;
      }
    ).handleMessage(directSession);

    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        isDirect: true,
        atSelf: true,
        messageId: "dm-1",
      }),
    );
  });
});
