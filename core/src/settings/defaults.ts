import type { CompactionPrompts } from "@yesimbot/agent/session";

import type { DeliverySettings } from "../delivery/types.js";

// Re-export for consumers that import DeliverySettings from this module
export type { DeliverySettings } from "../delivery/types.js";

// ============================================================================
// Runtime Settings Interface
// ============================================================================

/**
 * Athena runtime settings — unified configuration for agent behavior and delivery.
 * Managed by RuntimeSettingsManager in core; consumed by AgentSession as plain config.
 */
export interface RuntimeSettings {
  contextWindow: number;
  compaction: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    prompts?: CompactionPrompts;
  };
  retry: {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  delivery: DeliverySettings;
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  contextWindow: 128000,
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
  },
  steeringMode: "all",
  followUpMode: "all",
  delivery: {
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
  },
};
