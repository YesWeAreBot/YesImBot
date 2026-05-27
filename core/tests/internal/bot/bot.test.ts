import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

import { AthenaBot, type AthenaBotOptions } from "../../../src/internal/bot/bot.js";
import { createAthenaEvent } from "../../../src/internal/bot/events.js";
import {
  createDefaultChatMessagePresenter,
  createPresenterCatalog,
} from "../../../src/internal/bot/presentation.js";
import { createSpeakElementRegistry } from "../../../src/internal/bot/speak.js";
import type { SpeakAnomaly } from "../../../src/internal/bot/types.js";
import { DEFAULT_RUNTIME_SETTINGS } from "../../../src/internal/runtime/settings.js";

function createAthenaBot(overrides: Partial<AthenaBotOptions> = {}) {
  const koishiBot = {
    selfId: "bot-1",
    platform: "onebot",
    user: { name: "Athena" },
    sendMessage: vi.fn().mockResolvedValue(["fallback-message-id"]),
  };
  return new AthenaBot({
    channel: {
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      bot: koishiBot as never,
    },
    presenterCatalog: createPresenterCatalog(),
    speakElements: createSpeakElementRegistry(),
    deliverySettings: DEFAULT_RUNTIME_SETTINGS.delivery,
    appendEntry: vi.fn(),
    ...overrides,
  } as AthenaBotOptions);
}

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
    type: "message",
    platform: "onebot",
    channelId: "group-1",
    guildId: "guild-1",
    isDirect: false,
    messageId: "m-1",
    content: "hello",
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    author: { id: "user-1", name: "Alice" },
    userId: "user-1",
    stripped: { atSelf: false },
    bot: { selfId: "bot-1" },
    event: {
      type: "message",
      platform: "onebot",
      channel: { id: "group-1", type: 0 },
      guild: { id: "guild-1", name: "Guild" },
      message: {
        id: "m-1",
        content: "hello",
      },
      user: { id: "user-1", name: "Alice", avatar: "https://example.com/u1.png" },
      member: {
        user: { id: "user-1" },
        name: "Alice Member",
        avatar: "https://example.com/m1.png",
      },
      operator: { id: "user-2", name: "Bob" },
    },
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AthenaBot", () => {
  it("presents an observed event through registered presenter", async () => {
    const { bot } = createBot();
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    const presentation = await bot.present(event);

    expect(presentation?.content).toEqual(expect.stringContaining("hello"));
    expect(presentation?.visible).toBe(true);
  });

  it("speaks through origin session before falling back to bot.sendMessage", async () => {
    const { bot, koishiBot } = createBot();
    const session = createSession();

    await bot.speak("hello", { originSession: session as never, modelElapsedMs: 0 });

    expect(session.send).toHaveBeenCalledWith("hello");
    expect(koishiBot.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to Koishi bot when no origin session exists", async () => {
    const { bot, koishiBot } = createBot();

    await bot.speak("hello", { modelElapsedMs: 0 });

    expect(koishiBot.sendMessage).toHaveBeenCalledWith("group-1", "hello");
  });

  it("persists speak anomalies as non-LLM custom entries", () => {
    const { bot, appendEntry } = createBot();
    const anomaly: SpeakAnomaly = {
      version: 1,
      kind: "send_failed",
      timestamp: 1,
      source: "athena-bot",
      reason: "blocked",
      generatedContent: "hello",
      attemptedSegments: ["hello"],
      failedSegments: ["hello"],
    };

    bot.persistSpeakAnomalies([anomaly]);

    expect(appendEntry).toHaveBeenCalledWith("athena:speak_anomaly", {
      display: false,
      details: anomaly,
    });
  });

  it("materializes presenters inside AthenaBot from the presenter catalog", async () => {
    const catalog = createPresenterCatalog();
    catalog.registerBase("chat_message", createDefaultChatMessagePresenter());
    const appendEntry = vi.fn();
    const bot = createAthenaBot({
      presenterCatalog: catalog,
      appendEntry,
    });
    const event = createAthenaEvent("chat_message", {
      source: {
        platform: "onebot",
        channelId: "group-1",
        conversationType: "group",
        selfId: "bot-1",
      },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    await expect(bot.present(event)).resolves.toMatchObject({
      visible: true,
      text: "Alice: hello",
    });
  });
});
