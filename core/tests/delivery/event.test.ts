import { describe, expect, it } from "vitest";

import { createDeliveryEvent } from "../../src/runtime/delivery";

describe("createDeliveryEvent", () => {
  it("creates a cancelled event with required fields", () => {
    const event = createDeliveryEvent({
      kind: "cancelled",
      reason: "session disposed",
      generatedContent: "你好<sep/>再见",
      attemptedSegments: ["你好", "再见"],
    });
    expect(event.customType).toBe("athena:delivery_event");
    expect(event.display).toBe(false);
    expect(event.details.version).toBe(1);
    expect(event.details.kind).toBe("cancelled");
    expect(event.details.source).toBe("delivery");
    expect(event.details.reason).toBe("session disposed");
    expect(event.details.generatedContent).toBe("你好<sep/>再见");
    expect(event.details.attemptedSegments).toEqual(["你好", "再见"]);
    expect(event.details.timestamp).toBeGreaterThan(0);
  });

  it("creates a failed event with error", () => {
    const error = new Error("network timeout");
    const event = createDeliveryEvent({
      kind: "failed",
      reason: "submit failed",
      generatedContent: "测试内容",
      attemptedSegments: ["测试内容"],
      error,
    });
    expect(event.details.kind).toBe("failed");
    expect(event.details.error).toBe(error);
  });

  it("creates a partial_failed event with delivered and failed segments", () => {
    const event = createDeliveryEvent({
      kind: "partial_failed",
      reason: "1 of 2 segments failed",
      generatedContent: "第一段<sep/>第二段",
      attemptedSegments: ["第一段", "第二段"],
      deliveredSegments: ["第一段"],
      failedSegments: ["第二段"],
    });
    expect(event.details.kind).toBe("partial_failed");
    expect(event.details.deliveredSegments).toEqual(["第一段"]);
    expect(event.details.failedSegments).toEqual(["第二段"]);
  });

  it("creates a filtered event", () => {
    const event = createDeliveryEvent({
      kind: "filtered",
      reason: "content filtered by platform",
      generatedContent: "被过滤的内容",
      attemptedSegments: ["被过滤的内容"],
    });
    expect(event.details.kind).toBe("filtered");
    expect(event.details.deliveredSegments).toBeUndefined();
    expect(event.details.failedSegments).toBeUndefined();
    expect(event.details.error).toBeUndefined();
  });

  it("does not include optional fields when not provided", () => {
    const event = createDeliveryEvent({
      kind: "cancelled",
      reason: "user requested stop",
      generatedContent: "内容",
      attemptedSegments: ["内容"],
    });
    expect(event.details.deliveredSegments).toBeUndefined();
    expect(event.details.failedSegments).toBeUndefined();
    expect(event.details.error).toBeUndefined();
  });
});
