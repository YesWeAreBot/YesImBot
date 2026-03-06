import type { Events } from "koishi";
import { describe, it, expect } from "vitest";

describe("Event Type Declarations", () => {
  it("should declare athena:willingness.changed with correct signature", () => {
    type Handler = Events["athena:willingness.changed"];

    const handler: Handler = (channelKey, oldValue, newValue) => {
      expect(channelKey).toHaveProperty("platform");
      expect(channelKey).toHaveProperty("channelId");
      expect(typeof oldValue).toBe("number");
      expect(typeof newValue).toBe("number");
    };

    handler({ platform: "test", channelId: "ch1" }, 0.5, 0.8);
  });

  it("should declare athena:timeline.compressed with correct signature", () => {
    type Handler = Events["athena:timeline.compressed"];

    const handler: Handler = (channelKey, beforeCount, afterCount) => {
      expect(channelKey).toHaveProperty("platform");
      expect(typeof beforeCount).toBe("number");
      expect(typeof afterCount).toBe("number");
    };

    handler({ platform: "test", channelId: "ch1" }, 10, 5);
  });

  it("should declare athena:cache.evicted with correct signature", () => {
    type Handler = Events["athena:cache.evicted"];

    const handler: Handler = (cacheType, id, reason) => {
      expect(["image", "entity"]).toContain(cacheType);
      expect(typeof id).toBe("string");
      expect(["ttl", "lru", "manual"]).toContain(reason);
    };

    handler("image", "img-123", "ttl");
  });

  it("should use athena: prefix for all events", () => {
    const events: (keyof Events)[] = [
      "athena:willingness.changed",
      "athena:timeline.compressed",
      "athena:cache.evicted",
    ];

    events.forEach((event) => {
      expect(event.startsWith("athena:")).toBe(true);
    });
  });

  it("should enforce type safety for event payloads", () => {
    // Compile-time type check: these assignments should work
    const willingnessHandler: Events["athena:willingness.changed"] = (key, old, newVal) => {
      expect(key.platform).toBeDefined();
      expect(key.channelId).toBeDefined();
    };

    const timelineHandler: Events["athena:timeline.compressed"] = (key, before, after) => {
      expect(before).toBeGreaterThanOrEqual(after);
    };

    const cacheHandler: Events["athena:cache.evicted"] = (type, id, reason) => {
      expect(type).toBeDefined();
    };

    // Execute handlers to satisfy test
    willingnessHandler({ platform: "test", channelId: "ch1" }, 0.5, 0.8);
    timelineHandler({ platform: "test", channelId: "ch1" }, 10, 5);
    cacheHandler("image", "img-123", "ttl");
  });

  it("should support multiple event subscribers pattern", () => {
    // Test that handler signature allows multiple subscribers
    const handlers: Events["athena:willingness.changed"][] = [];

    handlers.push((key, old, newVal) => {
      expect(newVal).toBeGreaterThan(old);
    });

    handlers.push((key, old, newVal) => {
      expect(key.platform).toBe("test");
    });

    // Execute all handlers
    handlers.forEach((h) => h({ platform: "test", channelId: "ch1" }, 0.5, 0.8));
    expect(handlers).toHaveLength(2);
  });
});
