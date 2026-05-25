import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const element = await import("@satorijs/element");
  return { h: element.default };
});

import { createCoreFallbackObservers } from "../../src/bot/default-observers.js";

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
    selfId: "bot-1",
    bot: { selfId: "bot-1" },
    event: {
      type: "message",
      platform: "onebot",
      channel: { id: "group-1", type: 0 },
      guild: { id: "guild-1", name: "Guild" },
      message: { id: "m-1", content: "hello" },
      user: { id: "user-1", name: "Alice", avatar: "https://example.com/u1.png" },
      member: { user: { id: "user-1" }, name: "Alice Member" },
      operator: { id: "user-2", name: "Bob" },
    },
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function findObserver(name: string) {
  const observer = createCoreFallbackObservers().find((candidate) => candidate.name === name);
  if (!observer) throw new Error(`Missing observer ${name}`);
  return observer;
}

describe("core fallback observers", () => {
  it("normalizes message middleware into chat_message", async () => {
    const observer = findObserver("core.message");
    const session = createSession({ stripped: { atSelf: true } });

    const result = await observer.handle({
      source: { kind: "middleware" },
      session: session as never,
      selfId: "bot-1",
      args: [session],
    });

    expect(result).toMatchObject({
      type: "event",
      event: {
        kind: "chat_message",
        source: {
          platform: "onebot",
          channelId: "group-1",
          conversationType: "group",
          selfId: "bot-1",
        },
        actor: { id: "user-1", name: "Alice" },
        payload: { messageId: "m-1", content: "hello" },
        metadata: { persist: true, triggerCandidate: true },
      },
    });
  });

  it("normalizes message-deleted into message_recall", async () => {
    const observer = findObserver("core.message-deleted");
    const session = createSession({
      type: "message-deleted",
      event: {
        type: "message-deleted",
        platform: "onebot",
        channel: { id: "group-1", type: 0 },
        guild: { id: "guild-1" },
        message: { id: "m-2", user: { id: "user-9", name: "Carol" } },
        operator: { id: "user-2", name: "Bob" },
      },
    });

    const result = await observer.handle({
      source: { kind: "koishi-event", eventName: "message-deleted" },
      eventName: "message-deleted",
      session: session as never,
      selfId: "bot-1",
      args: [session],
    });

    expect(result).toMatchObject({
      type: "event",
      event: {
        kind: "message_recall",
        payload: { messageId: "m-2", originalSender: { id: "user-9", name: "Carol" } },
        metadata: { persist: true, triggerCandidate: false },
      },
    });
  });

  it("normalizes reaction-added into reaction", async () => {
    const observer = findObserver("core.reaction-added");
    const session = createSession({
      type: "reaction-added",
      event: {
        type: "reaction-added",
        platform: "onebot",
        channel: { id: "group-1", type: 0 },
        guild: { id: "guild-1" },
        message: { id: "m-3" },
        user: { id: "user-3", name: "Dana" },
        emoji: { name: "👍" },
      },
    });

    const result = await observer.handle({
      source: { kind: "koishi-event", eventName: "reaction-added" },
      eventName: "reaction-added",
      session: session as never,
      selfId: "bot-1",
      args: [session],
    });

    expect(result).toMatchObject({
      type: "event",
      event: {
        kind: "reaction",
        payload: { messageId: "m-3", emoji: "👍", action: "add" },
      },
    });
  });

  it("normalizes guild-member-added into member_change", async () => {
    const observer = findObserver("core.guild-member-added");
    const session = createSession({
      type: "guild-member-added",
      event: {
        type: "guild-member-added",
        platform: "onebot",
        channel: { id: "group-1", type: 0 },
        guild: { id: "guild-1" },
        user: { id: "user-4", name: "Eve" },
        member: { user: { id: "user-4" }, name: "Eve Member" },
        operator: { id: "admin-1", name: "Admin" },
      },
    });

    const result = await observer.handle({
      source: { kind: "koishi-event", eventName: "guild-member-added" },
      eventName: "guild-member-added",
      session: session as never,
      selfId: "bot-1",
      args: [session],
    });

    expect(result).toMatchObject({
      type: "event",
      event: {
        kind: "member_change",
        target: { id: "user-4", name: "Eve Member" },
        payload: { action: "join", groupId: "guild-1" },
      },
    });
  });
});
