import { Logger } from "koishi";
import { describe, expect, it, vi } from "vitest";

import type { HorizonView } from "../src/services/horizon/types";
import { TimelineEventType, TimelinePriority, TimelineStage } from "../src/services/horizon/types";
import { validateAndFixHorizonView } from "../src/services/horizon/validation";

describe("validateAndFixHorizonView", () => {
  it("should fill all missing fields from empty object", () => {
    const result = validateAndFixHorizonView({});
    expect(result.self).toEqual({ id: "", name: "" });
    expect(result.environment).toEqual({
      type: "unknown",
      id: "",
      name: "",
      platform: "unknown",
      channelId: "",
    });
    expect(result.entities).toEqual([]);
    expect(result.history).toEqual([]);
  });

  it("should preserve existing fields", () => {
    const env = {
      type: "guild",
      id: "ch1",
      name: "General",
      platform: "discord",
      channelId: "ch1",
    };
    const self = { id: "bot1", name: "TestBot" };
    const entities = [{ id: "u1", type: "user", name: "Alice" }];
    const result = validateAndFixHorizonView({ self, environment: env, entities, history: [] });
    expect(result.self).toBe(self);
    expect(result.environment).toBe(env);
    expect(result.entities).toBe(entities);
  });

  it("should fill only missing fields", () => {
    const self = { id: "bot1", name: "TestBot" };
    const result = validateAndFixHorizonView({ self });
    expect(result.self).toBe(self);
    expect(result.environment.type).toBe("unknown");
    expect(result.entities).toEqual([]);
    expect(result.history).toEqual([]);
  });

  it("should log warning when fixing fields", () => {
    const mockLogger = { warn: vi.fn() } as unknown as Logger;
    validateAndFixHorizonView({}, mockLogger);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("fixed missing fields"),
      expect.stringContaining("self"),
    );
  });

  it("should not log when all fields are present", () => {
    const mockLogger = { warn: vi.fn() } as unknown as Logger;
    const view = {
      self: { id: "bot1", name: "TestBot" },
      environment: {
        type: "guild",
        id: "ch1",
        name: "General",
        platform: "discord",
        channelId: "ch1",
      },
      entities: [],
      history: [],
    };
    validateAndFixHorizonView(view, mockLogger);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe("HorizonView JSON roundtrip", () => {
  it("should preserve all fields through JSON serialize/deserialize", () => {
    const view: HorizonView = {
      self: { id: "bot1", name: "TestBot", role: "admin" },
      environment: {
        type: "guild",
        id: "ch1",
        name: "General",
        platform: "discord",
        channelId: "ch1",
        description: "Main channel",
      },
      entities: [
        {
          id: "u1",
          type: "user",
          name: "Alice",
          userId: "alice123",
          username: "alice",
          nickname: "Ali",
        },
      ],
      history: [],
    };
    const json = JSON.stringify(view);
    const parsed = JSON.parse(json);
    expect(parsed.self.id).toBe("bot1");
    expect(parsed.self.role).toBe("admin");
    expect(parsed.environment.platform).toBe("discord");
    expect(parsed.environment.description).toBe("Main channel");
    expect(parsed.entities[0].nickname).toBe("Ali");
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.history).toHaveLength(0);
  });

  it("should handle Date fields in timeline entries", () => {
    const now = new Date("2026-01-15T10:30:00.000Z");
    const view: HorizonView = {
      self: { id: "bot1", name: "TestBot" },
      environment: {
        type: "guild",
        id: "ch1",
        name: "General",
        platform: "discord",
        channelId: "ch1",
      },
      entities: [],
      history: [
        {
          id: "evt1",
          timestamp: now,
          platform: "discord",
          channelId: "ch1",
          type: TimelineEventType.Message,
          priority: TimelinePriority.Normal,
          stage: TimelineStage.Active,
          data: {
            messageId: "msg1",
            senderId: "u1",
            senderName: "Alice",
            content: "Hello",
          },
        },
      ],
    };
    const json = JSON.stringify(view);
    const parsed = JSON.parse(json);
    expect(parsed.history[0].timestamp).toBe("2026-01-15T10:30:00.000Z");
    const reconstructedDate = new Date(parsed.history[0].timestamp);
    expect(reconstructedDate.getTime()).toBe(now.getTime());
  });

  it("should preserve validated view through roundtrip", () => {
    const validated = validateAndFixHorizonView({});
    const json = JSON.stringify(validated);
    const parsed = JSON.parse(json);
    const revalidated = validateAndFixHorizonView(parsed);
    expect(revalidated.self).toEqual(validated.self);
    expect(revalidated.environment).toEqual(validated.environment);
    expect(revalidated.entities).toEqual(validated.entities);
    expect(revalidated.history).toEqual(validated.history);
  });
});
