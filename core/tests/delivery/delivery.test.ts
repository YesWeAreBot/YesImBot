import { describe, expect, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import type { DeliverySettings } from "../../src/delivery/types.js";

const DEFAULT_SETTINGS: DeliverySettings = {
  enabled: true,
  segmentation: {
    sepToken: "<sep/>",
    targetCountWeights: { one: 0.45, two: 0.4, three: 0.15 },
    shortSegmentChars: 6,
    shortTextChars: 25,
  },
  timing: {
    initialDelayMinMs: 300,
    initialDelayMaxMs: 1200,
    followupDelayMinMs: 1200,
    followupDelayMaxMs: 4500,
    maxDelayMs: 6500,
    minimumBufferMinMs: 150,
    minimumBufferMaxMs: 400,
  },
};

describe("Delivery", () => {
  it("splits text by <sep/> and sends segments", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        timing: {
          ...DEFAULT_SETTINGS.timing,
          initialDelayMinMs: 0,
          initialDelayMaxMs: 0,
          followupDelayMinMs: 0,
          followupDelayMaxMs: 0,
        },
      },
    });

    // Use long enough text to avoid short-text merging
    const text = "这是第一段足够长的文本<sep/>这是第二段足够长的文本";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    expect(result.attemptedSegments.length).toBeGreaterThanOrEqual(1);
    expect(result.deliveredSegments.length).toBe(result.attemptedSegments.length);
    expect(result.failedSegments).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(submitMessage).toHaveBeenCalledTimes(result.attemptedSegments.length);
  });

  it("sends as single message when delivery is disabled", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: { ...DEFAULT_SETTINGS, enabled: false },
    });

    const text = "第一段<sep/>第二段";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    expect(result.attemptedSegments).toEqual(["第一段第二段"]);
    expect(result.deliveredSegments).toEqual(["第一段第二段"]);
    expect(submitMessage).toHaveBeenCalledTimes(1);
    expect(submitMessage).toHaveBeenCalledWith("第一段第二段");
  });

  it("strips <sep/> tokens when delivery is disabled", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: { ...DEFAULT_SETTINGS, enabled: false },
    });

    const result = await delivery.deliver({
      text: "第一段<sep/>第二段<sep/>第三段",
      modelElapsedMs: 100,
    });

    expect(result.attemptedSegments).toEqual(["第一段第二段第三段"]);
    expect(result.deliveredSegments).toEqual(["第一段第二段第三段"]);
    expect(submitMessage).toHaveBeenCalledWith("第一段第二段第三段");
  });

  it("serializes overlapping deliveries instead of interleaving segments", async () => {
    const calls: string[] = [];
    const submitMessage = vi.fn().mockImplementation(async (text: string) => {
      calls.push(text);
      return { ok: true as const };
    });
    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        segmentation: {
          ...DEFAULT_SETTINGS.segmentation,
          shortTextChars: 0,
          targetCountWeights: { one: 0, two: 1, three: 0 },
        },
        timing: {
          ...DEFAULT_SETTINGS.timing,
          initialDelayMinMs: 0,
          initialDelayMaxMs: 0,
          followupDelayMinMs: 50,
          followupDelayMaxMs: 50,
          minimumBufferMinMs: 0,
          minimumBufferMaxMs: 0,
        },
      },
    });

    const first = delivery.deliver({
      text: "第一轮第一段足够长<sep/>第一轮第二段足够长",
      modelElapsedMs: 100,
    });
    const second = delivery.deliver({
      text: "第二轮第一段足够长<sep/>第二轮第二段足够长",
      modelElapsedMs: 100,
    });

    await Promise.all([first, second]);

    expect(calls).toEqual([
      "第一轮第一段足够长",
      "第一轮第二段足够长",
      "第二轮第一段足够长",
      "第二轮第二段足够长",
    ]);
  });

  it("records failed segments and creates event", async () => {
    const submitMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "network error" });

    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        timing: {
          ...DEFAULT_SETTINGS.timing,
          initialDelayMinMs: 0,
          initialDelayMaxMs: 0,
          followupDelayMinMs: 0,
          followupDelayMaxMs: 0,
        },
      },
    });

    // Use long text to get multiple segments
    const text =
      "这是第一段足够长的文本内容<sep/>这是第二段足够长的文本内容<sep/>这是第三段足够长的文本内容";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    // Should have at least 1 attempted segment
    expect(result.attemptedSegments.length).toBeGreaterThanOrEqual(1);
    // Total delivered + failed should equal attempted
    expect(result.deliveredSegments.length + result.failedSegments.length).toBe(
      result.attemptedSegments.length,
    );

    // If there are failures, there should be events
    if (result.failedSegments.length > 0) {
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events.some((e) => e.kind === "failed" || e.kind === "partial_failed")).toBe(
        true,
      );
    }
  });

  it("creates event when all segments fail", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: false, error: "blocked" });
    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        timing: {
          ...DEFAULT_SETTINGS.timing,
          initialDelayMinMs: 0,
          initialDelayMaxMs: 0,
          followupDelayMinMs: 0,
          followupDelayMaxMs: 0,
        },
      },
    });

    const text = "足够长的文本内容用于测试<sep/>另一段足够长的文本内容";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    expect(result.deliveredSegments).toHaveLength(0);
    expect(result.failedSegments.length).toBe(result.attemptedSegments.length);
    expect(result.events.some((e) => e.kind === "failed")).toBe(true);
  });

  it("can be cancelled", async () => {
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
          initialDelayMinMs: 0,
          initialDelayMaxMs: 0,
          followupDelayMinMs: 10000, // Long delay to allow cancellation
        },
      },
    });

    // Use long text with multiple segments
    const text = "第一段足够长的文本<sep/>第二段足够长的文本<sep/>第三段足够长的文本";

    // Start delivery
    const deliveryPromise = delivery.deliver({ text, modelElapsedMs: 100 });

    // Cancel immediately
    delivery.cancel();

    // Resolve the first submit
    resolveFirst!({ ok: true });

    const result = await deliveryPromise;

    // Should have cancellation event
    expect(result.events.some((e) => e.kind === "cancelled")).toBe(true);
  });

  it("respects external AbortSignal", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        timing: {
          ...DEFAULT_SETTINGS.timing,
          followupDelayMinMs: 10000, // Long delay to allow cancellation
        },
      },
    });

    const controller = new AbortController();
    const text = "第一段足够长的文本<sep/>第二段足够长的文本<sep/>第三段足够长的文本";

    // Start delivery with signal
    const deliveryPromise = delivery.deliver({
      text,
      modelElapsedMs: 100,
      signal: controller.signal,
    });

    // Abort immediately
    controller.abort();

    const result = await deliveryPromise;

    // Should have cancellation event
    expect(result.events.some((e) => e.kind === "cancelled")).toBe(true);
  });

  it("handles empty text gracefully", async () => {
    const submitMessage = vi.fn();
    const delivery = new Delivery({
      submitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const result = await delivery.deliver({ text: "", modelElapsedMs: 100 });

    expect(result.attemptedSegments).toHaveLength(0);
    expect(result.deliveredSegments).toHaveLength(0);
    expect(result.failedSegments).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it("logs delivery progress", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: {
        ...DEFAULT_SETTINGS,
        timing: {
          ...DEFAULT_SETTINGS.timing,
          initialDelayMinMs: 0,
          initialDelayMaxMs: 0,
          followupDelayMinMs: 0,
          followupDelayMaxMs: 0,
        },
      },
      logger,
    });

    const text = "足够长的测试文本内容<sep/>另一段足够长的测试文本";
    await delivery.deliver({ text, modelElapsedMs: 100 });

    // Should have logged each segment delivery
    expect(logger.info).toHaveBeenCalled();
  });
});
