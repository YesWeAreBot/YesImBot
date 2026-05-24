/**
 * RetryHandler — exponential backoff state machine for transient errors.
 *
 * Extracted from AgentSession to allow independent testing.
 * Handles:
 *   - Retryable error detection
 *   - Exponential backoff delay calculation
 *   - Abortable sleep
 *   - Retry attempt tracking
 */

import type { AssistantMessage } from "../agent/types.js";

export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 60000,
};

export interface RetryEvents {
  onStart: (attempt: number, maxAttempts: number, delayMs: number, errorMessage: string) => void;
  onEnd: (success: boolean, attempt: number, finalError?: string) => void;
}

/**
 * Regex matching transient/retryable error messages.
 * Context overflow errors are NOT retryable (handled by compaction).
 */
const RETRYABLE_ERROR_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|timed? out|timeout|terminated|retry delay/i;

export class RetryHandler {
  private _settings: RetrySettings;
  private _attempt = 0;
  private _abortController: AbortController | undefined;
  private _promise: Promise<void> | undefined;
  private _resolve: (() => void) | undefined;
  private _events: RetryEvents;

  constructor(settings: Partial<RetrySettings> = {}, events?: Partial<RetryEvents>) {
    this._settings = { ...DEFAULT_RETRY_SETTINGS, ...settings };
    this._events = {
      onStart: events?.onStart ?? (() => {}),
      onEnd: events?.onEnd ?? (() => {}),
    };
  }

  get attempt(): number {
    return this._attempt;
  }

  get isRetrying(): boolean {
    return this._promise !== undefined;
  }

  get enabled(): boolean {
    return this._settings.enabled;
  }

  set enabled(value: boolean) {
    this._settings.enabled = value;
  }

  updateSettings(settings: Partial<RetrySettings>): void {
    this._settings = { ...this._settings, ...settings };
  }

  /**
   * Check if an error is retryable.
   */
  isRetryableError(message: AssistantMessage): boolean {
    if (message.finishReason !== "error" || !message.errorMessage) return false;
    return RETRYABLE_ERROR_PATTERN.test(message.errorMessage);
  }

  /**
   * Create a retry promise synchronously (called before async processing).
   * If no retry promise exists and error is retryable, creates one.
   */
  prepareRetryIfNeeded(message: AssistantMessage): void {
    if (this._promise) return;
    if (!this._settings.enabled) return;
    if (!this.isRetryableError(message)) return;

    this._promise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  /**
   * Handle a retryable error with exponential backoff.
   * @returns true if retry was initiated, false if max retries exceeded or disabled
   */
  async handleRetryableError(message: AssistantMessage): Promise<boolean> {
    const settings = this._settings;
    if (!settings.enabled) {
      this._resolveRetry();
      return false;
    }

    if (!this._promise) {
      this._promise = new Promise((resolve) => {
        this._resolve = resolve;
      });
    }

    this._attempt++;

    if (this._attempt > settings.maxRetries) {
      this._events.onEnd(false, this._attempt - 1, message.errorMessage);
      this._attempt = 0;
      this._resolveRetry();
      return false;
    }

    const delayMs = settings.baseDelayMs * 2 ** (this._attempt - 1);

    this._events.onStart(
      this._attempt,
      settings.maxRetries,
      delayMs,
      message.errorMessage || "Unknown error",
    );

    // Abortable sleep
    this._abortController = new AbortController();
    try {
      await sleep(delayMs, this._abortController.signal);
    } catch {
      // Aborted during sleep
      const attempt = this._attempt;
      this._attempt = 0;
      this._abortController = undefined;
      this._events.onEnd(false, attempt, "Retry cancelled");
      this._resolveRetry();
      return false;
    }
    this._abortController = undefined;

    return true;
  }

  /**
   * Reset retry counter on success.
   */
  resetOnSuccess(): void {
    if (this._attempt > 0) {
      this._events.onEnd(true, this._attempt);
      this._attempt = 0;
    }
  }

  /**
   * Cancel in-progress retry.
   */
  abort(): void {
    this._abortController?.abort();
    this._resolveRetry();
  }

  /**
   * Wait for any in-progress retry to complete.
   */
  async waitForRetry(): Promise<void> {
    if (!this._promise) return;
    await this._promise;
  }

  /**
   * Resolve the pending retry promise.
   */
  private _resolveRetry(): void {
    if (this._resolve) {
      this._resolve();
      this._resolve = undefined;
      this._promise = undefined;
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Sleep aborted"));
      },
      { once: true },
    );
  });
}
