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

interface CreateDeliveryEventInput {
  kind: DeliveryEventDetails["kind"];
  reason: string;
  generatedContent: string;
  attemptedSegments: string[];
  deliveredSegments?: string[];
  failedSegments?: string[];
  error?: unknown;
}

interface TimingInput {
  /** Time the model took to generate the response (ms) */
  modelElapsedMs: number;
  /** Minimum initial delay before first message (ms) */
  initialDelayMinMs: number;
  /** Maximum initial delay before first message (ms) */
  initialDelayMaxMs: number;
  /** Minimum delay between followup messages (ms) */
  followupDelayMinMs: number;
  /** Maximum delay between followup messages (ms) */
  followupDelayMaxMs: number;
  /** Minimum buffer to always keep, even if model耗时 exceeds target (ms) */
  minimumBufferMinMs: number;
  /** Maximum buffer to always keep (ms) */
  minimumBufferMaxMs: number;
  /** Number of segments to send */
  segmentCount: number;
  /** Seed for reproducible random delays */
  seed?: number;
}

interface SegmenterOptions {
  /** Seed for reproducible random merging */
  seed?: number;
  /** Segments shorter than this (in Chinese chars) are merged into neighbors */
  shortSegmentChars?: number;
  /** If total text is shorter than this, merge everything into one segment */
  shortTextChars?: number;
  /** Probability weights for target segment count */
  targetCountWeights?: { one: number; two: number; three: number };
}

/**
 * Simple seeded PRNG (mulberry32) for reproducible random numbers.
 */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const createSeededRandom = mulberry32;

/**
 * Create a delivery event for anomaly tracking.
 *
 * Delivery events are only created for cancelled, filtered, failed, or partial_failed
 * scenarios. Successful deliveries do not create events (they have assistant messages).
 */
export function createDeliveryEvent(input: CreateDeliveryEventInput): DeliveryEvent {
  const details: DeliveryEventDetails = {
    version: 1,
    kind: input.kind,
    timestamp: Date.now(),
    source: "delivery",
    reason: input.reason,
    generatedContent: input.generatedContent,
    attemptedSegments: input.attemptedSegments,
  };

  if (input.deliveredSegments !== undefined) {
    details.deliveredSegments = input.deliveredSegments;
  }

  if (input.failedSegments !== undefined) {
    details.failedSegments = input.failedSegments;
  }

  if (input.error !== undefined) {
    details.error = input.error;
  }

  return {
    customType: "athena:delivery_event",
    display: false,
    details,
  };
}

/**
 * Plan delivery timing for a multi-segment message.
 *
 * Algorithm:
 * 1. Pick a random target delay from [initialDelayMinMs, initialDelayMaxMs]
 * 2. Subtract modelElapsedMs from the target
 * 3. If remaining < minimum buffer, use minimum buffer instead
 * 4. For followup segments, pick random delays from [followupDelayMinMs, followupDelayMaxMs]
 */
export function planDeliveryTiming(input: TimingInput): DeliveryTimingPlan {
  const {
    modelElapsedMs,
    initialDelayMinMs,
    initialDelayMaxMs,
    followupDelayMinMs,
    followupDelayMaxMs,
    minimumBufferMinMs,
    minimumBufferMaxMs,
    segmentCount,
    seed,
  } = input;

  const random = seed !== undefined ? mulberry32(seed) : Math.random;

  // Pick random target delay within initial range
  const targetDelay = initialDelayMinMs + random() * (initialDelayMaxMs - initialDelayMinMs);

  // Subtract model elapsed time
  let firstDelayMs = targetDelay - modelElapsedMs;

  // Pick random minimum buffer
  const minBuffer = minimumBufferMinMs + random() * (minimumBufferMaxMs - minimumBufferMinMs);

  // Ensure we keep at least the minimum buffer
  firstDelayMs = Math.max(firstDelayMs, minBuffer);

  // Generate followup delays
  const followupDelaysMs: number[] = [];
  for (let i = 1; i < segmentCount; i++) {
    const delay = followupDelayMinMs + random() * (followupDelayMaxMs - followupDelayMinMs);
    followupDelaysMs.push(delay);
  }

  return {
    firstDelayMs: Math.round(firstDelayMs),
    followupDelaysMs: followupDelaysMs.map((d) => Math.round(d)),
  };
}

/**
 * Count Chinese characters in a string (CJK Unified Ideographs + common punctuation).
 */
function countChineseChars(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    // CJK Unified Ideographs range + common CJK punctuation
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Split assistant text by <sep/> and apply random merging to produce 1-3 final segments.
 *
 * Rules:
 * 1. Split on <sep/> token
 * 2. Short segments (< shortSegmentChars Chinese chars) merge into adjacent segments
 * 3. If total text is short (< shortTextChars Chinese chars), merge everything into 1 segment
 * 4. Randomly merge to target 1-3 segments with given weights
 * 5. Never split a segment again after merging
 */
export function splitDeliverySegments(
  text: string,
  options?: SegmenterOptions,
): DeliverySegmentPlan {
  const {
    seed,
    shortSegmentChars = 6,
    shortTextChars = 25,
    targetCountWeights = { one: 0.45, two: 0.4, three: 0.15 },
  } = options ?? {};

  const random = seed !== undefined ? mulberry32(seed) : Math.random;

  // Step 1: Split on <sep/>
  const rawSegments = text
    .split(/<sep\/>/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // If no segments or only one, return as-is
  if (rawSegments.length <= 1) {
    return { rawSegments, finalSegments: [...rawSegments] };
  }

  // Step 2: Check if total text is very short
  const totalChineseChars = rawSegments.reduce((sum, seg) => sum + countChineseChars(seg), 0);
  if (totalChineseChars < shortTextChars) {
    const merged = rawSegments.join(" ");
    return { rawSegments, finalSegments: [merged] };
  }

  // Step 3: Merge short segments into neighbors
  let workingSegments = [...rawSegments];
  let i = 0;
  while (i < workingSegments.length) {
    if (countChineseChars(workingSegments[i]) < shortSegmentChars) {
      if (workingSegments.length === 1) break;

      if (i === 0) {
        // Merge with next
        workingSegments[1] = workingSegments[0] + workingSegments[1];
        workingSegments.shift();
      } else if (i === workingSegments.length - 1) {
        // Merge with previous
        workingSegments[i - 1] = workingSegments[i - 1] + workingSegments[i];
        workingSegments.pop();
        i--;
      } else {
        // Merge with the shorter neighbor
        const prevLen = countChineseChars(workingSegments[i - 1]);
        const nextLen = countChineseChars(workingSegments[i + 1]);
        if (prevLen <= nextLen) {
          workingSegments[i - 1] = workingSegments[i - 1] + workingSegments[i];
          workingSegments.splice(i, 1);
          i--;
        } else {
          workingSegments[i + 1] = workingSegments[i] + workingSegments[i + 1];
          workingSegments.splice(i, 1);
        }
      }
    } else {
      i++;
    }
  }

  // If after merging short segments we only have 1, return
  if (workingSegments.length <= 1) {
    return { rawSegments, finalSegments: workingSegments };
  }

  // Step 4: Random merge to target count (1-3)
  const targetCount = pickTargetCount(random, targetCountWeights, workingSegments.length);

  while (workingSegments.length > targetCount) {
    // Find the pair of adjacent segments with the shortest combined length
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let j = 0; j < workingSegments.length - 1; j++) {
      const combinedLen =
        countChineseChars(workingSegments[j]) + countChineseChars(workingSegments[j + 1]);
      if (combinedLen < bestLen) {
        bestLen = combinedLen;
        bestIdx = j;
      }
    }
    // Merge the pair
    workingSegments[bestIdx] = workingSegments[bestIdx] + workingSegments[bestIdx + 1];
    workingSegments.splice(bestIdx + 1, 1);
  }

  return { rawSegments, finalSegments: workingSegments };
}

/**
 * Pick target segment count (1-3) based on weights, capped by actual segment count.
 */
function pickTargetCount(
  random: () => number,
  weights: { one: number; two: number; three: number },
  maxCount: number,
): number {
  const r = random();
  let cumulative = 0;

  cumulative += weights.one;
  if (r < cumulative || maxCount <= 1) return 1;

  cumulative += weights.two;
  if (r < cumulative || maxCount <= 2) return Math.min(2, maxCount);

  return Math.min(3, maxCount);
}
