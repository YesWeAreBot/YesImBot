import { describe, expect, it } from "vitest";

import { WillingnessEngine } from "../willingness";
import type { WillingnessConfig } from "../willingness";

/**
 * Unit tests for WILL-01: directBoost on DM trigger type.
 *
 * RED until 23-03 adds directBoost handling to WillingnessEngine.processMessage.
 * Currently, triggerType "direct" gets no special boost — only "mention" and "reply" do.
 */

function createDefaultConfig(): WillingnessConfig {
  return {
    decay: { halfLife: 300, elasticThreshold: 0.7 },
    gain: { baseGain: 15, keywordMultiplier: 1.5, keywords: [] },
    sigmoid: { midpoint: 0.5, steepness: 10 },
    fatigue: {
      windowMs: 120000,
      threshold: 3,
      penaltyBase: 0.5,
    },
    maxWillingness: 100,
    mentionBoost: 0.8,
    dm: {
      directBoost: 0.95,
      aggregationMinMs: 3000,
      aggregationMaxMs: 8000,
      aggregationCapMs: 15000,
    },
  };
}

describe("WillingnessEngine directBoost", () => {
  it("directBoost applied for direct trigger type", () => {
    const config = createDefaultConfig();
    const engine = new WillingnessEngine(config);

    const result = engine.processMessage("dm-channel-1", "direct", "hello");

    // DM messages should get a high probability via directBoost (0.95)
    // Similar to how mentionBoost works for "mention"/"reply" triggers
    expect(result.probability).toBeGreaterThanOrEqual(0.9);
  });
});
