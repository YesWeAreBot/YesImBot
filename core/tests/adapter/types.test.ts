import { describe, it, expect } from "vitest";

import { createEvent } from "../../src/adapter/types.js";

describe("createEvent", () => {
  it("should create a ChatMessageEvent with all required fields", () => {
    const event = createEvent("chat_message", {
      source: {
        platform: "onebot",
        channelId: "123456",
        conversationType: "group" as const,
      },
      actor: { id: "user1", name: "Alice" },
      details: {
        messageId: "msg1",
        elements: [],
      },
      meta: { persist: true, triggerCandidate: true },
    });

    expect(event.kind).toBe("chat_message");
    expect(event.id).toMatch(/^[a-z0-9-]+$/);
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.source.platform).toBe("onebot");
    expect(event.actor.name).toBe("Alice");
    expect(event.details.messageId).toBe("msg1");
    expect(event.meta.persist).toBe(true);
  });

  it("should generate unique IDs for each event", () => {
    const a = createEvent("chat_message", {
      source: { platform: "onebot", channelId: "1", conversationType: "group" as const },
      actor: { id: "u1" },
      details: { messageId: "m1", elements: [] },
      meta: { persist: true, triggerCandidate: false },
    });
    const b = createEvent("chat_message", {
      source: { platform: "onebot", channelId: "1", conversationType: "group" as const },
      actor: { id: "u1" },
      details: { messageId: "m2", elements: [] },
      meta: { persist: true, triggerCandidate: false },
    });
    expect(a.id).not.toBe(b.id);
  });
});
