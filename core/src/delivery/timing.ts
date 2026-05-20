import { mulberry32 } from "./random.js";
import type { DeliveryTimingPlan } from "./types.js";

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
