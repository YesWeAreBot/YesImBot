/**
 * Delivery module types for Athena's natural interaction layer.
 *
 * Delivery is responsible for splitting assistant text into natural segments,
 * calculating timing delays, and recording delivery events for anomalies.
 */

/**
 * Configuration for the delivery module.
 * Part of RuntimeSettings, managed by core runtime configuration.
 */
export interface DeliverySettings {
  enabled: boolean;
  segmentation: {
    sepToken: "<sep/>";
    targetCountWeights: { one: number; two: number; three: number };
    shortSegmentChars: number;
    shortTextChars: number;
  };
  timing: {
    initialDelayMinMs: number;
    initialDelayMaxMs: number;
    followupDelayMinMs: number;
    followupDelayMaxMs: number;
    maxDelayMs: number;
    minimumBufferMinMs: number;
    minimumBufferMaxMs: number;
  };
}

/**
 * Result of segmenting assistant text.
 */
export interface DeliverySegmentPlan {
  /** Raw segments split by <sep/> */
  rawSegments: string[];
  /** Final segments after random merging */
  finalSegments: string[];
}

/**
 * Result of planning delivery timing.
 */
export interface DeliveryTimingPlan {
  /** Delay before sending the first segment (ms) */
  firstDelayMs: number;
  /** Delays between subsequent segments (ms) */
  followupDelaysMs: number[];
}

/**
 * Details of a delivery event for anomaly tracking.
 * Only created for cancelled, filtered, failed, or partial_failed scenarios.
 */
export interface DeliveryEventDetails {
  version: 1;
  kind: "cancelled" | "filtered" | "failed" | "partial_failed";
  timestamp: number;
  source: "delivery";
  reason: string;
  generatedContent: string;
  attemptedSegments: string[];
  deliveredSegments?: string[];
  failedSegments?: string[];
  error?: unknown;
}

/**
 * Delivery event with Koishi custom message structure.
 */
export interface DeliveryEvent {
  customType: "athena:delivery_event";
  display: false;
  details: DeliveryEventDetails;
}

/**
 * Input for the Delivery.deliver() method.
 */
export interface DeliverySubmitInput {
  text: string;
  modelElapsedMs: number;
  channel?: { platform: string; channelId: string; type: "private" | "group" };
  signal?: AbortSignal;
}

/**
 * Result of a delivery operation.
 */
export interface DeliverySubmitResult {
  attemptedSegments: string[];
  deliveredSegments: string[];
  failedSegments: string[];
  events: DeliveryEventDetails[];
}
