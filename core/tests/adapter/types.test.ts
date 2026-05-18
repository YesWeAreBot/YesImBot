import { describe, it, expect } from "vitest";

import { createEvent, serializeEvent } from "../../src/adapter/types.js";
import type { EventMetadata } from "../../src/adapter/types.js";

const stubMetadata = { persist: true, triggerCandidate: true } as EventMetadata;

describe("createEvent", () => {
  it("should create a ChatMessageEvent with all required fields", () => {
    const event = createEvent("chat_message", {
      source: {
        platform: "onebot",
        channelId: "123456",
        conversationType: "group" as const,
      },
      actor: { id: "user1", name: "Alice" },
      payload: {
        messageId: "msg1",
        content: "hello",
      },
      metadata: stubMetadata,
    });

    expect(event.kind).toBe("chat_message");
    expect(event.id).toMatch(/^[a-z0-9-]+$/);
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.source.platform).toBe("onebot");
    expect(event.actor.name).toBe("Alice");
    expect(event.payload.messageId).toBe("msg1");
    expect(event.metadata.persist).toBe(true);
  });

  it("should generate unique IDs for each event", () => {
    const a = createEvent("chat_message", {
      source: { platform: "onebot", channelId: "1", conversationType: "group" as const },
      actor: { id: "u1" },
      payload: { messageId: "m1", content: "a" },
      metadata: stubMetadata,
    });
    const b = createEvent("chat_message", {
      source: { platform: "onebot", channelId: "1", conversationType: "group" as const },
      actor: { id: "u1" },
      payload: { messageId: "m2", content: "b" },
      metadata: stubMetadata,
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("serializeEvent", () => {
  it("should strip metadata and add version", () => {
    const event = createEvent("chat_message", {
      source: { platform: "onebot", channelId: "1", conversationType: "group" as const },
      actor: { id: "u1" },
      payload: { messageId: "m1", content: "hi" },
      metadata: stubMetadata,
    });

    const serialized = serializeEvent(event);

    expect(serialized.version).toBe(1);
    expect(serialized.id).toBe(event.id);
    expect(serialized.kind).toBe("chat_message");
    expect(serialized.payload).toEqual(event.payload);
    expect(serialized).not.toHaveProperty("metadata");
  });
});
