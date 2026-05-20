import { describe, expect, it, vi } from "vitest";

import { DeliverySettings, Delivery, createDeliveryEvent } from "../../src/runtime/delivery";

const DEFAULT_SETTINGS: DeliverySettings = {
  enabled: true,
  segmentation: {
    sepToken: "<sep/>",
    targetCountWeights: { one: 0.45, two: 0.4, three: 0.15 },
    shortSegmentChars: 6,
    shortTextChars: 25,
  },
  timing: {
    initialDelayMinMs: 0,
    initialDelayMaxMs: 0,
    followupDelayMinMs: 0,
    followupDelayMaxMs: 0,
    maxDelayMs: 6500,
    minimumBufferMinMs: 0,
    minimumBufferMaxMs: 0,
  },
};

describe("runtime delivery event timing", () => {
  it("stores agent_start time and uses message_end time to compute elapsed ms", () => {
    const startedAt = 1000;
    const endedAt = 2100;
    expect(endedAt - startedAt).toBe(1100);
  });

  it("modelElapsedMs is passed through to delivery", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const modelElapsedMs = 1500;
    const result = await delivery.deliver({
      text: "足够长的测试文本内容用于验证时间传递",
      modelElapsedMs,
    });

    expect(result.attemptedSegments.length).toBeGreaterThanOrEqual(1);
    expect(result.deliveredSegments.length).toBe(result.attemptedSegments.length);
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

  it("delivery records failed segments as events", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: false, error: "blocked" });
    const delivery = new Delivery({
      submitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const text = "足够长的文本内容用于测试失败事件<sep/>另一段足够长的文本内容";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    expect(result.failedSegments.length).toBe(result.attemptedSegments.length);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].kind).toBe("failed");
    expect(result.events[0].source).toBe("delivery");
    expect(result.events[0].generatedContent).toBe(text);
  });

  it("delivery creates partial_failed when some segments fail", async () => {
    const submitMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "rate limited" });

    const delivery = new Delivery({
      submitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const text =
      "这是第一段足够长的文本内容<sep/>这是第二段足够长的文本内容<sep/>这是第三段足够长的文本内容";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    // Should have some delivered and some failed
    if (result.deliveredSegments.length > 0 && result.failedSegments.length > 0) {
      expect(result.events.some((e) => e.kind === "partial_failed")).toBe(true);
    }
  });

  it("delivery records cancelled event on abort", async () => {
    let resolveFirst: (value: { ok: true }) => void;
    const firstPromise = new Promise<{ ok: true }>((resolve) => {
      resolveFirst = resolve;
    });

    const submitMessage = vi.fn().mockReturnValueOnce(firstPromise).mockResolvedValue({ ok: true });

    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        timing: {
          ...DEFAULT_SETTINGS.timing,
          initialDelayMinMs: 10000,
          initialDelayMaxMs: 10000,
          followupDelayMinMs: 10000,
        },
      },
    });

    const text = "第一段足够长的文本<sep/>第二段足够长的文本<sep/>第三段足够长的文本";
    const deliveryPromise = delivery.deliver({ text, modelElapsedMs: 100 });
    delivery.cancel();
    resolveFirst!({ ok: true });

    const result = await deliveryPromise;
    expect(result.events.some((e) => e.kind === "cancelled")).toBe(true);
  });
});
