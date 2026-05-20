import type { DeliveryEvent, DeliveryEventDetails } from "./types.js";

interface CreateDeliveryEventInput {
  kind: DeliveryEventDetails["kind"];
  reason: string;
  generatedContent: string;
  attemptedSegments: string[];
  deliveredSegments?: string[];
  failedSegments?: string[];
  error?: unknown;
}

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
