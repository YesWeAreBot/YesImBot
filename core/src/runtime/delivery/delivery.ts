import { createDeliveryEvent } from "./event.js";
import { splitDeliverySegments } from "./segmenter.js";
import { planDeliveryTiming } from "./timing.js";
import type {
  DeliveryEventDetails,
  DeliverySettings,
  DeliverySubmitInput,
  DeliverySubmitResult,
} from "./types.js";

interface DeliveryOptions {
  submitMessage: (text: string) => Promise<{ ok: true } | { ok: false; error: unknown }>;
  settings: DeliverySettings;
  logger?: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

/**
 * Delivery handles splitting assistant text into natural segments,
 * calculating timing delays, and sending them via the platform adapter.
 *
 * It also tracks delivery anomalies (cancelled, failed, etc.) as events.
 */
export class Delivery {
  private readonly _submitMessage: (
    text: string,
  ) => Promise<{ ok: true } | { ok: false; error: unknown }>;
  private readonly _settings: DeliverySettings;
  private readonly _logger: DeliveryOptions["logger"];
  private _queueTail: Promise<void> = Promise.resolve();
  private _activeAbortController: AbortController | null = null;
  private readonly _pendingAbortControllers = new Set<AbortController>();
  private _seedCounter = 0;

  constructor(options: DeliveryOptions) {
    this._submitMessage = options.submitMessage;
    this._settings = options.settings;
    this._logger = options.logger;
  }

  /**
   * Deliver assistant text as natural segmented messages.
   *
   * 1. Split text by <sep/> and apply random merging
   * 2. Calculate timing delays (accounting for model elapsed time)
   * 3. Send each segment with appropriate delays
   * 4. Track any failures or cancellations
   */
  async deliver(input: DeliverySubmitInput): Promise<DeliverySubmitResult> {
    const abortController = new AbortController();
    this._pendingAbortControllers.add(abortController);
    const run = this._queueTail.then(
      () => this._runDelivery(input, abortController),
      () => this._runDelivery(input, abortController),
    );
    this._queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async _runDelivery(
    input: DeliverySubmitInput,
    abortController: AbortController,
  ): Promise<DeliverySubmitResult> {
    const { text, modelElapsedMs, signal } = input;
    this._pendingAbortControllers.delete(abortController);
    this._activeAbortController = abortController;

    try {
      const deliverySignal = abortController.signal;
      const combinedSignal = signal ? AbortSignal.any([deliverySignal, signal]) : deliverySignal;

      if (!this._settings.enabled) {
        // Delivery disabled, but protocol tokens must never reach the platform.
        const submitText = stripSepTokens(text);
        if (submitText.length === 0) {
          return {
            attemptedSegments: [],
            deliveredSegments: [],
            failedSegments: [],
            events: [],
          };
        }
        if (combinedSignal.aborted) {
          const event = createDeliveryEvent({
            kind: "cancelled",
            reason: "delivery cancelled",
            generatedContent: text,
            attemptedSegments: [submitText],
            failedSegments: [submitText],
          });
          return {
            attemptedSegments: [submitText],
            deliveredSegments: [],
            failedSegments: [submitText],
            events: [event.details],
          };
        }
        const result = await this._submitMessage(submitText);
        if (result.ok) {
          return {
            attemptedSegments: [submitText],
            deliveredSegments: [submitText],
            failedSegments: [],
            events: [],
          };
        } else {
          const event = createDeliveryEvent({
            kind: "failed",
            reason: "submit failed (delivery disabled)",
            generatedContent: text,
            attemptedSegments: [submitText],
            failedSegments: [submitText],
            error: result.error,
          });
          return {
            attemptedSegments: [submitText],
            deliveredSegments: [],
            failedSegments: [submitText],
            events: [event.details],
          };
        }
      }

      // Step 1: Split and merge segments
      const seed = this._nextSeed();
      const { finalSegments } = splitDeliverySegments(text, {
        seed,
        shortSegmentChars: this._settings.segmentation.shortSegmentChars,
        shortTextChars: this._settings.segmentation.shortTextChars,
        targetCountWeights: this._settings.segmentation.targetCountWeights,
      });

      if (finalSegments.length === 0) {
        return {
          attemptedSegments: [],
          deliveredSegments: [],
          failedSegments: [],
          events: [],
        };
      }

      // Step 2: Plan timing
      const timing = planDeliveryTiming({
        modelElapsedMs,
        initialDelayMinMs: this._settings.timing.initialDelayMinMs,
        initialDelayMaxMs: this._settings.timing.initialDelayMaxMs,
        followupDelayMinMs: this._settings.timing.followupDelayMinMs,
        followupDelayMaxMs: this._settings.timing.followupDelayMaxMs,
        minimumBufferMinMs: this._settings.timing.minimumBufferMinMs,
        minimumBufferMaxMs: this._settings.timing.minimumBufferMaxMs,
        segmentCount: finalSegments.length,
        seed: this._nextSeed(),
      });

      // Step 3: Send segments with delays
      const deliveredSegments: string[] = [];
      const failedSegments: string[] = [];
      const events: DeliveryEventDetails[] = [];

      for (let i = 0; i < finalSegments.length; i++) {
        // Check if cancelled
        if (combinedSignal.aborted) {
          const remaining = finalSegments.slice(i);
          const event = createDeliveryEvent({
            kind: "cancelled",
            reason: "delivery cancelled",
            generatedContent: text,
            attemptedSegments: finalSegments,
            deliveredSegments: [...deliveredSegments],
            failedSegments: remaining,
          });
          events.push(event.details);
          this._logger?.warn("Delivery cancelled", {
            delivered: deliveredSegments.length,
            remaining: remaining.length,
          });
          break;
        }

        // Apply delay
        const delay = i === 0 ? timing.firstDelayMs : timing.followupDelaysMs[i - 1];
        if (delay > 0) {
          await this._sleep(delay, combinedSignal);
          // Re-check after sleep
          if (combinedSignal.aborted) {
            const remaining = finalSegments.slice(i);
            const event = createDeliveryEvent({
              kind: "cancelled",
              reason: "delivery cancelled during delay",
              generatedContent: text,
              attemptedSegments: finalSegments,
              deliveredSegments: [...deliveredSegments],
              failedSegments: remaining,
            });
            events.push(event.details);
            break;
          }
        }

        // Send the segment
        try {
          const result = await this._submitMessage(finalSegments[i]);
          if (result.ok) {
            deliveredSegments.push(finalSegments[i]);
            this._logger?.info(`Segment ${i + 1}/${finalSegments.length} delivered`);
          } else {
            failedSegments.push(finalSegments[i]);
            const event = createDeliveryEvent({
              kind: "failed",
              reason: "submit failed",
              generatedContent: text,
              attemptedSegments: finalSegments,
              deliveredSegments: [...deliveredSegments],
              failedSegments: [finalSegments[i]],
              error: result.error,
            });
            events.push(event.details);
            this._logger?.error(`Segment ${i + 1}/${finalSegments.length} failed`, result.error);
          }
        } catch (error) {
          failedSegments.push(finalSegments[i]);
          const event = createDeliveryEvent({
            kind: "failed",
            reason: "submit threw exception",
            generatedContent: text,
            attemptedSegments: finalSegments,
            deliveredSegments: [...deliveredSegments],
            failedSegments: [finalSegments[i]],
            error,
          });
          events.push(event.details);
          this._logger?.error(`Segment ${i + 1}/${finalSegments.length} threw`, error);
        }
      }

      // Create partial_failed event if some segments failed
      if (failedSegments.length > 0 && deliveredSegments.length > 0) {
        const event = createDeliveryEvent({
          kind: "partial_failed",
          reason: `${failedSegments.length} of ${finalSegments.length} segments failed`,
          generatedContent: text,
          attemptedSegments: finalSegments,
          deliveredSegments,
          failedSegments,
        });
        events.push(event.details);
      }

      return {
        attemptedSegments: finalSegments,
        deliveredSegments,
        failedSegments,
        events,
      };
    } finally {
      if (this._activeAbortController === abortController) {
        this._activeAbortController = null;
      }
    }
  }

  /**
   * Cancel any in-progress delivery.
   */
  cancel(): void {
    if (this._activeAbortController) {
      this._activeAbortController.abort();
    }
    for (const controller of this._pendingAbortControllers) {
      controller.abort();
    }
    this._pendingAbortControllers.clear();
  }

  private _nextSeed(): number {
    return Date.now() + this._seedCounter++;
  }

  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      const timeout = setTimeout(resolve, ms);

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      }
    });
  }
}

function stripSepTokens(text: string): string {
  if (!text.includes("<sep/>")) return text;
  return text
    .split(/<sep\/>/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("");
}
