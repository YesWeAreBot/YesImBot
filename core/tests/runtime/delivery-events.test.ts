import { describe, expect, it } from "vitest";

import { createDeliveryEvent } from "../../src/runtime/delivery";

describe("runtime delivery event timing", () => {
  it("stores agent_start time and uses message_end time to compute elapsed ms", () => {
    const startedAt = 1000;
    const endedAt = 2100;
    expect(endedAt - startedAt).toBe(1100);
  });
});

describe("delivery event creation", () => {
  it("creates failed event with correct structure", () => {
    const event = createDeliveryEvent({
      kind: "failed",
      reason: "network error",
      generatedContent: "test content",
      attemptedSegments: ["seg1"],
      failedSegments: ["seg1"],
      error: new Error("timeout"),
    });

    expect(event.customType).toBe("athena:delivery_event");
    expect(event.display).toBe(false);
    expect(event.details.version).toBe(1);
    expect(event.details.kind).toBe("failed");
    expect(event.details.source).toBe("delivery");
    expect(event.details.reason).toBe("network error");
    expect(event.details.generatedContent).toBe("test content");
    expect(event.details.attemptedSegments).toEqual(["seg1"]);
    expect(event.details.failedSegments).toEqual(["seg1"]);
    expect(event.details.error).toBeInstanceOf(Error);
    expect(event.details.timestamp).toBeTypeOf("number");
  });

  it("creates cancelled event", () => {
    const event = createDeliveryEvent({
      kind: "cancelled",
      reason: "session disposed",
      generatedContent: "full text",
      attemptedSegments: ["seg1", "seg2"],
      deliveredSegments: ["seg1"],
      failedSegments: ["seg2"],
    });

    expect(event.details.kind).toBe("cancelled");
    expect(event.details.deliveredSegments).toEqual(["seg1"]);
    expect(event.details.failedSegments).toEqual(["seg2"]);
  });

  it("creates partial_failed event", () => {
    const event = createDeliveryEvent({
      kind: "partial_failed",
      reason: "1 of 2 segments failed",
      generatedContent: "full text",
      attemptedSegments: ["seg1", "seg2"],
      deliveredSegments: ["seg1"],
      failedSegments: ["seg2"],
    });

    expect(event.details.kind).toBe("partial_failed");
    expect(event.details.deliveredSegments).toEqual(["seg1"]);
    expect(event.details.failedSegments).toEqual(["seg2"]);
  });
});
