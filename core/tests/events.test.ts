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
});
