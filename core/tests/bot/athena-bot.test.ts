import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

import { AthenaBot } from "../../src/bot/athena-bot.js";
import { createAthenaEvent } from "../../src/bot/events.js";
import {
  createDefaultChatMessagePresenter,
  createPresenterRegistry,
} from "../../src/bot/presenter.js";
import { createSpeakElementRegistry } from "../../src/bot/speak-elements.js";
import type { SpeakAnomaly } from "../../src/bot/types.js";

function createBot() {
  const presenters = createPresenterRegistry();
  presenters.registerBase("chat_message", createDefaultChatMessagePresenter());
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
    presenters,
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
  it("observes a Koishi session into chat_message event", () => {
    const { bot } = createBot();
    const session = createSession({ stripped: { atSelf: true } });

    const event = bot.observe(session as never);

    expect(event).toMatchObject({
      kind: "chat_message",
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });
    expect(event?.metadata.originSession).toBe(session);
  });

  it("observes message-deleted into message_recall event", () => {
    const { bot } = createBot();
    const session = createSession({
      type: "message-deleted",
      messageId: "m-2",
      author: undefined,
      userId: undefined,
      event: {
        type: "message-deleted",
        platform: "onebot",
        channel: { id: "group-1", type: 0 },
        guild: { id: "guild-1", name: "Guild" },
        message: {
          id: "m-2",
          user: { id: "user-9", name: "Carol" },
        },
        operator: { id: "user-2", name: "Bob" },
      },
    });

    const event = bot.observe(session as never);

    expect(event).toMatchObject({
      kind: "message_recall",
      source: {
        platform: "onebot",
        channelId: "group-1",
        guildId: "guild-1",
        conversationType: "group",
      },
      actor: { id: "user-2", name: "Bob" },
      payload: {
        messageId: "m-2",
        originalSender: { id: "user-9", name: "Carol" },
      },
      metadata: { persist: true, triggerCandidate: false },
    });
    expect(event?.metadata.originSession).toBe(session);
  });

  it("observes reaction-added and reaction-removed into reaction events", () => {
    const { bot } = createBot();

    const added = bot.observe(
      createSession({
        type: "reaction-added",
        event: {
          type: "reaction-added",
          platform: "onebot",
          channel: { id: "group-1", type: 0 },
          guild: { id: "guild-1", name: "Guild" },
          message: { id: "m-3" },
          user: { id: "user-3", name: "Dana" },
          operator: { id: "user-3", name: "Dana" },
          emoji: { name: "👍" },
        },
      }) as never,
    );
    const removed = bot.observe(
      createSession({
        type: "reaction-removed",
        event: {
          type: "reaction-removed",
          platform: "onebot",
          channel: { id: "group-1", type: 0 },
          guild: { id: "guild-1", name: "Guild" },
          message: { id: "m-3" },
          user: { id: "user-3", name: "Dana" },
          emoji: "👍",
        },
      }) as never,
    );

    expect(added).toMatchObject({
      kind: "reaction",
      actor: { id: "user-3", name: "Dana" },
      payload: { messageId: "m-3", emoji: "👍", action: "add" },
      metadata: { persist: true, triggerCandidate: false },
    });
    expect(removed).toMatchObject({
      kind: "reaction",
      actor: { id: "user-3", name: "Dana" },
      payload: { messageId: "m-3", emoji: "👍", action: "remove" },
      metadata: { persist: true, triggerCandidate: false },
    });
  });

  it("observes guild-member-added and guild-member-removed into member_change events", () => {
    const { bot } = createBot();

    const joined = bot.observe(
      createSession({
        type: "guild-member-added",
        event: {
          type: "guild-member-added",
          platform: "onebot",
          channel: { id: "group-1", type: 0 },
          guild: { id: "guild-1", name: "Guild" },
          user: { id: "user-4", name: "Eve" },
          member: { user: { id: "user-4" }, name: "Eve Member" },
          operator: { id: "admin-1", name: "Admin" },
        },
      }) as never,
    );
    const removed = bot.observe(
      createSession({
        type: "guild-member-removed",
        event: {
          type: "guild-member-removed",
          platform: "onebot",
          channel: { id: "group-1", type: 0 },
          guild: { id: "guild-1", name: "Guild" },
          user: { id: "user-5", name: "Frank" },
          member: { user: { id: "user-5" }, name: "Frank Member" },
        },
      }) as never,
    );

    expect(joined).toMatchObject({
      kind: "member_change",
      actor: { id: "admin-1", name: "Admin" },
      target: { id: "user-4", name: "Eve Member" },
      payload: { action: "join", groupId: "guild-1" },
      metadata: { persist: true, triggerCandidate: false },
    });
    expect(removed).toMatchObject({
      kind: "member_change",
      actor: { id: "user-5", name: "Frank Member" },
      target: { id: "user-5", name: "Frank Member" },
      payload: { action: "leave", groupId: "guild-1" },
      metadata: { persist: true, triggerCandidate: false },
    });
  });

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
});
