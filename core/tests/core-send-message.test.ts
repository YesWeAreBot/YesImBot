import { describe, expect, it, vi } from "vitest";

import { TimelineStage } from "../src/services/horizon/types";
import { CorePlugin } from "../src/services/plugin/builtin/core";

describe("CorePlugin send_message regression", () => {
  function createHarness() {
    const ctx = {
      bots: [
        {
          platform: "discord",
          selfId: "bot-1",
          user: { name: "Athena" },
          sendMessage: vi.fn(async () => "target-msg-1"),
        },
      ],
      on: vi.fn(),
    } as unknown as Record<string, unknown>;

    const horizon = {
      recordMessage: vi.fn(async () => undefined),
    };
    ctx["yesimbot.horizon"] = horizon;
    ctx["yesimbot.plugin"] = {
      registerPlugin: vi.fn(),
      unregisterPlugin: vi.fn(),
    };

    const session = {
      send: vi.fn(async () => "session-msg-1"),
    };

    const plugin = new CorePlugin(ctx as never);
    return { plugin, session, ctx, horizon };
  }

  it("creates regression harness with concrete mocks", () => {
    const { session, ctx, horizon } = createHarness();
    expect(horizon.recordMessage).toBeTypeOf("function");
    expect(session.send).toBeTypeOf("function");
    const bots = (ctx as { bots?: Array<{ sendMessage?: unknown }> }).bots;
    expect(bots?.[0]?.sendMessage).toBeTypeOf("function");
  });

  it("records current-session send_message outputs to horizon with senderId selfId and Active stage", async () => {
    const { plugin, horizon, session } = createHarness();

    await plugin.sendMessage(
      { content: "hello timeline" },
      {
        platform: "discord",
        channelId: "c-1",
        session: session as never,
        bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
      },
    );

    expect(horizon.recordMessage).toHaveBeenCalledTimes(1);
    expect(horizon.recordMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "discord",
        channelId: "c-1",
        stage: TimelineStage.Active,
        data: expect.objectContaining({
          senderId: "bot-1",
          content: "hello timeline",
        }),
      }),
    );
  });

  it("returns send_message result metadata with messageId and content for scenario timeline consumers", async () => {
    const { plugin, session } = createHarness();

    const result = await plugin.sendMessage(
      { content: "first<sep/>second" },
      {
        platform: "discord",
        channelId: "c-1",
        session: session as never,
        bot: { selfId: "bot-1", user: { name: "Athena" } } as never,
      },
    );

    if (!result.success) {
      throw new Error(result.error ?? "send_message failed unexpectedly");
    }

    expect(result.success).toBe(true);
    expect(result.content).toEqual(
      expect.objectContaining({
        status: "sent",
        partCount: 2,
        messageId: "session-msg-1",
        content: "first\nsecond",
        messages: [
          expect.objectContaining({ messageId: "session-msg-1", content: "first" }),
          expect.objectContaining({ messageId: "session-msg-1", content: "second" }),
        ],
      }),
    );
  });
});
