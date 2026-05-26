import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

import { AthenaBot } from "../../src/internal/bot/bot.js";
import {
  createDefaultChatMessagePresenter,
  createPresenterCatalog,
} from "../../src/internal/bot/presentation.js";
import { createSpeakElementRegistry } from "../../src/internal/bot/speak.js";

function createBot() {
  const catalog = createPresenterCatalog();
  catalog.registerBase("chat_message", createDefaultChatMessagePresenter());
  const speakElements = createSpeakElementRegistry();
  const appendEntry = vi.fn<(customType: string, data?: unknown) => void>();
  const koishiBot = {
    selfId: "bot-1",
    user: { name: "Athena" },
    sendMessage: vi.fn().mockResolvedValue(["fallback-message-id"]),
  };

  const bot = new AthenaBot({
    channel: {
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      bot: koishiBot as never,
    },
    presenterCatalog: catalog,
    speakElements,
    appendEntry,
    deliverySettings: {
      enabled: false,
      segmentation: {
        sepToken: "<sep/>",
        targetCountWeights: { one: 1, two: 0, three: 0 },
        shortSegmentChars: 6,
        shortTextChars: 25,
      },
      timing: {
        initialDelayMinMs: 0,
        initialDelayMaxMs: 0,
        followupDelayMinMs: 0,
        followupDelayMaxMs: 0,
        maxDelayMs: 0,
        minimumBufferMinMs: 0,
        minimumBufferMaxMs: 0,
      },
    },
  });

  return { bot, koishiBot, appendEntry };
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    platform: "onebot",
    channelId: "group-1",
    isDirect: false,
    messageId: "m-1",
    content: "hello",
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    author: { id: "user-1", name: "Alice" },
    userId: "user-1",
    stripped: { atSelf: false },
    bot: { selfId: "bot-1" },
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AthenaBot.speak", () => {
  it("records send failure and partial failure through origin session delivery", async () => {
    const { bot, koishiBot, appendEntry } = createBot();
    const session = createSession({
      send: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked")),
    });

    const result = await bot.speak("第一段<sep/>第二段", {
      originSession: session as never,
      modelElapsedMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.deliveredSegments).toEqual(["第一段"]);
    expect(result.failedSegments).toEqual(["第二段"]);
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(koishiBot.sendMessage).not.toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith(
      "athena:speak_anomaly",
      expect.objectContaining({
        display: false,
        details: expect.objectContaining({ kind: "send_failed", failedSegments: ["第二段"] }),
      }),
    );
    expect(appendEntry).toHaveBeenCalledWith(
      "athena:speak_anomaly",
      expect.objectContaining({
        display: false,
        details: expect.objectContaining({
          kind: "partial_failed",
          deliveredSegments: ["第一段"],
          failedSegments: ["第二段"],
        }),
      }),
    );
  });

  it("keeps platform send inside AthenaBot when no origin session exists", async () => {
    const { bot, koishiBot, appendEntry } = createBot();
    koishiBot.sendMessage = vi.fn().mockRejectedValue(new Error("send failed"));

    const result = await bot.speak("hello", { modelElapsedMs: 0 });

    expect(result.ok).toBe(false);
    expect(result.failedSegments).toEqual(["hello"]);
    expect(koishiBot.sendMessage).toHaveBeenCalledWith("group-1", "hello");
    expect(appendEntry).toHaveBeenCalledWith(
      "athena:speak_anomaly",
      expect.objectContaining({
        display: false,
        details: expect.objectContaining({ kind: "send_failed", failedSegments: ["hello"] }),
      }),
    );
  });

  it("records cancelled anomaly before any platform send", async () => {
    const { bot, koishiBot, appendEntry } = createBot();
    const controller = new AbortController();
    controller.abort();

    const result = await bot.speak("第一段<sep/>第二段", {
      modelElapsedMs: 0,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    expect(result.deliveredSegments).toEqual([]);
    expect(result.failedSegments).toEqual(["第一段", "第二段"]);
    expect(koishiBot.sendMessage).not.toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith(
      "athena:speak_anomaly",
      expect.objectContaining({
        display: false,
        details: expect.objectContaining({
          kind: "cancelled",
          failedSegments: ["第一段", "第二段"],
        }),
      }),
    );
  });
});
