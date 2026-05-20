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
    initialDelayMinMs: 0,
    initialDelayMaxMs: 0,
    followupDelayMinMs: 0,
    followupDelayMaxMs: 0,
    maxDelayMs: 6500,
    minimumBufferMinMs: 0,
    minimumBufferMaxMs: 0,
  },
};

describe("RuntimeService delivery submit path", () => {
  it("Delivery uses the provided submitMessage callback for each segment", async () => {
    const submitMessage = vi.fn().mockResolvedValue({ ok: true });
    const delivery = new Delivery({
      submitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const text = "这是第一段足够长的文本<sep/>这是第二段足够长的文本";
    const result = await delivery.deliver({ text, modelElapsedMs: 100 });

    expect(submitMessage).toHaveBeenCalledTimes(result.attemptedSegments.length);
    for (const segment of result.attemptedSegments) {
      expect(submitMessage).toHaveBeenCalledWith(segment);
    }
  });

  it("adapter submitMessage pattern works with Delivery", async () => {
    const mockBot = { sendMessage: vi.fn().mockResolvedValue(["msg1"]) };
    const adapterSubmitMessage = vi.fn().mockImplementation(async (text: string) => {
      try {
        await mockBot.sendMessage("chan1", text);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error };
      }
    });

    const delivery = new Delivery({
      submitMessage: adapterSubmitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const text = "足够长的测试文本内容用于验证";
    const result = await delivery.deliver({ text, modelElapsedMs: 50 });

    expect(result.deliveredSegments.length).toBe(result.attemptedSegments.length);
    expect(result.failedSegments).toHaveLength(0);
    expect(mockBot.sendMessage).toHaveBeenCalledWith("chan1", expect.any(String));
  });

  it("adapter submitMessage failure propagates to delivery result", async () => {
    const error = new Error("send failed");
    const adapterSubmitMessage = vi.fn().mockResolvedValue({ ok: false, error });

    const delivery = new Delivery({
      submitMessage: adapterSubmitMessage,
      settings: DEFAULT_SETTINGS,
    });

    const text = "足够长的测试文本内容用于验证失败";
    const result = await delivery.deliver({ text, modelElapsedMs: 50 });

    expect(result.failedSegments.length).toBe(result.attemptedSegments.length);
    expect(result.deliveredSegments).toHaveLength(0);
    expect(result.events.some((e) => e.kind === "failed")).toBe(true);
  });
});
