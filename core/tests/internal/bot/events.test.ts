import { describe, expect, it } from "vitest";

import {
  createAthenaEvent,
  isAthenaEvent,
  serializeAthenaEvent,
} from "../../../src/internal/bot/events.js";
import type { AthenaEvent } from "../../../src/internal/bot/types.js";

declare module "../../../src/internal/bot/types.js" {
  interface AthenaEventMap {
    "test:custom": { value: number };
  }
}

describe("AthenaEvent typed map", () => {
  it("creates a typed chat_message event", () => {
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1", name: "Alice" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    expect(event.kind).toBe("chat_message");
    expect(event.payload.messageId).toBe("m-1");
    expect(event.metadata.persist).toBe(true);
  });

  it("supports event map declaration merging", () => {
    const event = createAthenaEvent("test:custom", {
      source: { platform: "test", channelId: "ch", conversationType: "private" },
      actor: { id: "u" },
      payload: { value: 42 },
      metadata: { persist: false, triggerCandidate: false },
    });

    expect(event.payload.value).toBe(42);
  });

  it("narrows event kind with a guard", () => {
    const event: AthenaEvent = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: false },
    });

    expect(isAthenaEvent(event, "chat_message")).toBe(true);
    if (isAthenaEvent(event, "chat_message")) {
      expect(event.payload.content).toBe("hello");
    }
  });

  it("serializes without runtime-only metadata fields", () => {
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    expect(serializeAthenaEvent(event)).toEqual({
      version: 1,
      id: event.id,
      kind: "chat_message",
      timestamp: event.timestamp,
      source: event.source,
      actor: event.actor,
      payload: event.payload,
    });
  });

  it("keeps source selfId in serialized event details", () => {
    const event = createAthenaEvent("chat_message", {
      source: {
        platform: "onebot",
        channelId: "group-1",
        conversationType: "group",
        selfId: "bot-1",
      },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    expect(serializeAthenaEvent(event)).toMatchObject({
      version: 1,
      source: {
        platform: "onebot",
        channelId: "group-1",
        conversationType: "group",
        selfId: "bot-1",
      },
    });
  });

  it("does not serialize raw runtime context from event metadata", () => {
    const event = createAthenaEvent("chat_message", {
      source: { platform: "onebot", channelId: "group-1", conversationType: "group" },
      actor: { id: "user-1" },
      payload: { messageId: "m-1", content: "hello" },
      metadata: { persist: true, triggerCandidate: true },
    });

    expect(serializeAthenaEvent(event)).not.toHaveProperty("metadata");
  });
});
