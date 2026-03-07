import { describe, it, expect } from "vitest";

import { MemoryType, MemoryScope } from "../src/services/memory-agent/types";
import { TimelineEventType } from "../src/services/horizon/types";
import {
  HeartbeatHandler,
} from "../src/services/horizon/handlers";
import type { TimelineEntry } from "../src/services/horizon/types";

describe("Memory types", () => {
  it("MemoryType enum has four categories", () => {
    expect(MemoryType.Profile).toBe("profile");
    expect(MemoryType.Event).toBe("event");
    expect(MemoryType.Channel).toBe("channel");
    expect(MemoryType.Experience).toBe("experience");
  });

  it("MemoryScope enum has three scopes", () => {
    expect(MemoryScope.User).toBe("user");
    expect(MemoryScope.Channel).toBe("channel");
    expect(MemoryScope.Private).toBe("private");
  });
});

describe("Heartbeat timeline type", () => {
  it("TimelineEventType.Heartbeat exists with value 'heartbeat'", () => {
    expect(TimelineEventType.Heartbeat).toBe("heartbeat");
  });

  describe("HeartbeatHandler", () => {
    const handler = new HeartbeatHandler();

    it("canHandle() returns true for heartbeat entries", () => {
      const heartbeatEntry = {
        id: "hb-001",
        timestamp: new Date(),
        platform: "test",
        channelId: "ch-001",
        type: TimelineEventType.Heartbeat,
        priority: 1,
        stage: "active",
        data: { triggeredBy: "global" },
      } as unknown as TimelineEntry;

      expect(handler.canHandle(heartbeatEntry)).toBe(true);
    });

    it("canHandle() returns false for non-heartbeat entries", () => {
      const messageEntry = {
        id: "msg-001",
        timestamp: new Date(),
        platform: "test",
        channelId: "ch-001",
        type: TimelineEventType.Message,
        priority: 1,
        stage: "active",
        data: { content: "hello" },
      } as unknown as TimelineEntry;

      expect(handler.canHandle(messageEntry)).toBe(false);
    });

    it("handle() returns empty messages (heartbeats are markers)", async () => {
      const heartbeatEntry = {
        id: "hb-001",
        timestamp: new Date(),
        platform: "test",
        channelId: "ch-001",
        type: TimelineEventType.Heartbeat,
        priority: 1,
        stage: "active",
        data: { triggeredBy: "global" },
      } as unknown as TimelineEntry;

      // canHandle must be true for this to work
      if (handler.canHandle(heartbeatEntry)) {
        const messages = await handler.handle(heartbeatEntry, {});
        expect(messages).toEqual([]);
      }
    });
  });
});
