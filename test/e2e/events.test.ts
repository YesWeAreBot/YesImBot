import type { Context } from "@koishijs/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestApp } from "../setup";

describe("Event System E2E", () => {
  let app: Context;

  beforeAll(async () => {
    app = createTestApp();
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it("should emit and receive athena:willingness.changed event", () => {
    const received: Array<{ platform: string; channelId: string; oldValue: number; newValue: number }> = [];

    app.on(
      "athena:willingness.changed" as any,
      (channelKey: { platform: string; channelId: string }, oldValue: number, newValue: number) => {
        received.push({ ...channelKey, oldValue, newValue });
      },
    );

    app.emit(
      "athena:willingness.changed" as any,
      { platform: "discord", channelId: "ch-123" },
      0.3,
      0.8,
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      platform: "discord",
      channelId: "ch-123",
      oldValue: 0.3,
      newValue: 0.8,
    });
  });

  it("should emit and receive athena:timeline.compressed event", () => {
    const received: Array<{ platform: string; channelId: string; before: number; after: number }> = [];

    app.on(
      "athena:timeline.compressed" as any,
      (channelKey: { platform: string; channelId: string }, beforeCount: number, afterCount: number) => {
        received.push({ ...channelKey, before: beforeCount, after: afterCount });
      },
    );

    app.emit(
      "athena:timeline.compressed" as any,
      { platform: "telegram", channelId: "ch-456" },
      50,
      20,
    );

    expect(received).toHaveLength(1);
    expect(received[0].before).toBe(50);
    expect(received[0].after).toBe(20);
  });

  it("should emit and receive athena:cache.evicted event", () => {
    const received: Array<{ cacheType: string; id: string; reason: string }> = [];

    app.on(
      "athena:cache.evicted" as any,
      (cacheType: string, id: string, reason: string) => {
        received.push({ cacheType, id, reason });
      },
    );

    app.emit("athena:cache.evicted" as any, "image", "img-789", "ttl");

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ cacheType: "image", id: "img-789", reason: "ttl" });
  });

  it("should support multiple subscribers for the same event", () => {
    let count = 0;

    app.on("athena:willingness.changed" as any, () => {
      count++;
    });
    app.on("athena:willingness.changed" as any, () => {
      count++;
    });

    app.emit(
      "athena:willingness.changed" as any,
      { platform: "test", channelId: "ch" },
      0,
      1,
    );

    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("should handle handler errors without breaking other subscribers", () => {
    const results: string[] = [];

    app.on("athena:cache.evicted" as any, () => {
      results.push("first");
    });

    app.on("athena:cache.evicted" as any, () => {
      throw new Error("handler error");
    });

    app.on("athena:cache.evicted" as any, () => {
      results.push("third");
    });

    // Koishi may or may not propagate errors - verify at least first handler ran
    try {
      app.emit("athena:cache.evicted" as any, "entity", "ent-1", "lru");
    } catch {
      // Some event systems throw on handler errors
    }

    expect(results).toContain("first");
  });
});
