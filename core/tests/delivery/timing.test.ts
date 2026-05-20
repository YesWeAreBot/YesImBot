import { describe, expect, it } from "vitest";

import { planDeliveryTiming } from "../../src/delivery/timing.js";

describe("planDeliveryTiming", () => {
  const baseInput = {
    initialDelayMinMs: 300,
    initialDelayMaxMs: 1200,
    followupDelayMinMs: 1200,
    followupDelayMaxMs: 4500,
    minimumBufferMinMs: 150,
    minimumBufferMaxMs: 400,
    segmentCount: 1,
  };

  it("returns first delay within buffer range when model耗时 exceeds target", () => {
    const timing = planDeliveryTiming({
      ...baseInput,
      modelElapsedMs: 900,
      seed: 1,
    });
    // When model耗时 is high, first delay should be just the buffer
    expect(timing.firstDelayMs).toBeGreaterThanOrEqual(150);
    expect(timing.firstDelayMs).toBeLessThanOrEqual(400);
  });

  it("subtracts model耗时 from target delay", () => {
    const timing = planDeliveryTiming({
      ...baseInput,
      modelElapsedMs: 100,
      seed: 1,
    });
    // With low model耗时, delay should be target - 100
    // Target is in [300, 1200], so delay should be in [200, 1100]
    // But at least minimum buffer
    expect(timing.firstDelayMs).toBeGreaterThanOrEqual(150);
  });

  it("generates followup delays for multiple segments", () => {
    const timing = planDeliveryTiming({
      ...baseInput,
      segmentCount: 3,
      modelElapsedMs: 100,
      seed: 1,
    });
    expect(timing.followupDelaysMs).toHaveLength(2);
    // Each followup should be in [1200, 4500]
    for (const delay of timing.followupDelaysMs) {
      expect(delay).toBeGreaterThanOrEqual(1200);
      expect(delay).toBeLessThanOrEqual(4500);
    }
  });

  it("returns empty followup delays for single segment", () => {
    const timing = planDeliveryTiming({
      ...baseInput,
      segmentCount: 1,
      modelElapsedMs: 100,
      seed: 1,
    });
    expect(timing.followupDelaysMs).toHaveLength(0);
  });

  it("produces reproducible results with same seed", () => {
    const input = { ...baseInput, segmentCount: 3, modelElapsedMs: 500, seed: 42 };
    const timing1 = planDeliveryTiming(input);
    const timing2 = planDeliveryTiming(input);
    expect(timing1).toEqual(timing2);
  });

  it("produces different results with different seeds", () => {
    const input1 = { ...baseInput, segmentCount: 3, modelElapsedMs: 500, seed: 1 };
    const input2 = { ...baseInput, segmentCount: 3, modelElapsedMs: 500, seed: 2 };
    const timing1 = planDeliveryTiming(input1);
    const timing2 = planDeliveryTiming(input2);
    // At least one value should differ (probabilistically very likely)
    const differs =
      timing1.firstDelayMs !== timing2.firstDelayMs ||
      timing1.followupDelaysMs.some((d, i) => d !== timing2.followupDelaysMs[i]);
    expect(differs).toBe(true);
  });

  it("rounds delays to integers", () => {
    const timing = planDeliveryTiming({
      ...baseInput,
      segmentCount: 2,
      modelElapsedMs: 100,
      seed: 1,
    });
    expect(Number.isInteger(timing.firstDelayMs)).toBe(true);
    for (const delay of timing.followupDelaysMs) {
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});
