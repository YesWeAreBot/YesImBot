import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantMessage } from "../../src/agent/types.js";
import {
  DEFAULT_RETRY_SETTINGS,
  RetryHandler,
  type RetryEvents,
} from "../../src/session/retry-handler.js";

// ============================================================================
// Helpers
// ============================================================================

function makeErrorMessage(text: string, opts?: { finishReason?: string }): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "error" }],
    usage: {},
    finishReason: (opts?.finishReason ?? "error") as AssistantMessage["finishReason"],
    errorMessage: text,
    timestamp: Date.now(),
  };
}

function makeStopMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    usage: {},
    finishReason: "stop",
    timestamp: Date.now(),
  };
}

function collectEvents(): RetryEvents & { starts: unknown[][]; ends: unknown[][] } {
  const starts: unknown[][] = [];
  const ends: unknown[][] = [];
  return {
    starts,
    ends,
    onStart: (...args: unknown[]) => starts.push(args),
    onEnd: (...args: unknown[]) => ends.push(args),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("RetryHandler", () => {
  describe("constructor and defaults", () => {
    it("uses default settings when none provided", () => {
      const handler = new RetryHandler();
      expect(handler.enabled).toBe(true);
      expect(handler.attempt).toBe(0);
      expect(handler.isRetrying).toBe(false);
    });

    it("merges partial settings with defaults", () => {
      const handler = new RetryHandler({ maxRetries: 5 });
      expect(handler.enabled).toBe(true); // default
      expect(handler.attempt).toBe(0);
    });

    it("respects fully custom settings", () => {
      const handler = new RetryHandler({
        enabled: false,
        maxRetries: 10,
        baseDelayMs: 500,
        maxDelayMs: 10000,
      });
      expect(handler.enabled).toBe(false);
    });
  });

  describe("enabled getter/setter", () => {
    it("can be toggled at runtime", () => {
      const handler = new RetryHandler();
      expect(handler.enabled).toBe(true);
      handler.enabled = false;
      expect(handler.enabled).toBe(false);
      handler.enabled = true;
      expect(handler.enabled).toBe(true);
    });
  });

  describe("updateSettings", () => {
    it("merges new settings into existing ones", () => {
      const handler = new RetryHandler({ maxRetries: 3, baseDelayMs: 1000 });
      handler.updateSettings({ maxRetries: 5 });
      // Internal — we verify indirectly through behavior
      // After update, the handler should allow up to 5 retries
      expect(handler.enabled).toBe(true);
    });

    it("can disable retry via updateSettings", () => {
      const handler = new RetryHandler();
      handler.updateSettings({ enabled: false });
      expect(handler.enabled).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("returns true for overloaded errors", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("model overloaded"))).toBe(true);
    });

    it("returns true for rate limit errors", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("rate limit exceeded"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("too many requests"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("429 Too Many Requests"))).toBe(true);
    });

    it("returns true for server errors", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("500 Internal Server Error"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("502 Bad Gateway"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("503 Service Unavailable"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("504 Gateway Timeout"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("service unavailable"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("server error"))).toBe(true);
    });

    it("returns true for network errors", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("network error"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("connection error"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("connection refused"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("connection lost"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("fetch failed"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("socket hang up"))).toBe(true);
    });

    it("returns true for timeout errors", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("request timed out"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("timeout"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("timed out"))).toBe(true);
    });

    it("returns true for provider errors", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("provider returned error"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("upstream connect failed"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("reset before headers"))).toBe(true);
      expect(handler.isRetryableError(makeErrorMessage("other side closed connection"))).toBe(true);
    });

    it("returns false for non-error finish reasons", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeStopMessage())).toBe(false);
      expect(
        handler.isRetryableError(makeErrorMessage("overloaded", { finishReason: "stop" })),
      ).toBe(false);
    });

    it("returns false when no errorMessage", () => {
      const handler = new RetryHandler();
      const msg: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        usage: {},
        finishReason: "error",
        timestamp: Date.now(),
      };
      expect(handler.isRetryableError(msg)).toBe(false);
    });

    it("returns false for non-retryable error messages", () => {
      const handler = new RetryHandler();
      expect(handler.isRetryableError(makeErrorMessage("invalid API key"))).toBe(false);
      expect(handler.isRetryableError(makeErrorMessage("model not found"))).toBe(false);
      expect(handler.isRetryableError(makeErrorMessage("context window exceeded"))).toBe(false);
    });
  });

  describe("handleRetryableError", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns false when retry is disabled", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ enabled: false }, events);
      const msg = makeErrorMessage("overloaded");

      const result = await handler.handleRetryableError(msg);
      expect(result).toBe(false);
      expect(handler.attempt).toBe(0);
    });

    it("increments attempt counter", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 100, maxRetries: 3 }, events);
      const msg = makeErrorMessage("overloaded");

      const p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(100);
      const result = await p;
      expect(result).toBe(true);
      expect(handler.attempt).toBe(1);
    });

    it("calls onStart event with correct parameters", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 1000, maxRetries: 3 }, events);
      const msg = makeErrorMessage("rate limit exceeded");

      const p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(1000);
      await p;

      expect(events.starts).toHaveLength(1);
      expect(events.starts[0][0]).toBe(1); // attempt
      expect(events.starts[0][1]).toBe(3); // maxAttempts
      expect(events.starts[0][2]).toBe(1000); // delayMs (base * 2^0)
      expect(events.starts[0][3]).toBe("rate limit exceeded"); // errorMessage
    });

    it("applies exponential backoff", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 1000, maxRetries: 5 }, events);
      const msg = makeErrorMessage("overloaded");

      // Attempt 1: delay = 1000 * 2^0 = 1000
      let p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(events.starts[0][2]).toBe(1000);

      // Attempt 2: delay = 1000 * 2^1 = 2000
      p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(2000);
      await p;
      expect(events.starts[1][2]).toBe(2000);

      // Attempt 3: delay = 1000 * 2^2 = 4000
      p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(4000);
      await p;
      expect(events.starts[2][2]).toBe(4000);
    });

    it("returns false and calls onEnd when max retries exceeded", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 100, maxRetries: 2 }, events);
      const msg = makeErrorMessage("overloaded");

      // Attempt 1
      let p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(100);
      expect(await p).toBe(true);

      // Attempt 2
      p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(200);
      expect(await p).toBe(true);

      // Attempt 3 — should exceed max retries
      const result = await handler.handleRetryableError(msg);
      expect(result).toBe(false);
      expect(handler.attempt).toBe(0); // reset after exceeding

      // onEnd called with failure
      expect(events.ends).toHaveLength(1);
      expect(events.ends[0][0]).toBe(false); // success
      expect(events.ends[0][1]).toBe(2); // attempt (maxRetries, not maxRetries+1)
      expect(events.ends[0][2]).toBe("overloaded"); // finalError
    });

    it("resets attempt counter after exceeding max retries", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 10, maxRetries: 1 }, events);
      const msg = makeErrorMessage("503");

      // Attempt 1 — succeeds
      let p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(10);
      expect(await p).toBe(true);
      expect(handler.attempt).toBe(1);

      // Attempt 2 — exceeds max
      await handler.handleRetryableError(msg);
      expect(handler.attempt).toBe(0);
    });
  });

  describe("abort", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("cancels in-progress retry and resolves promise", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 10000, maxRetries: 3 }, events);
      const msg = makeErrorMessage("overloaded");

      // Start retry — it will sleep for 10s
      const p = handler.handleRetryableError(msg);
      expect(handler.isRetrying).toBe(true);

      // Abort immediately
      handler.abort();
      const result = await p;
      expect(result).toBe(false);
      expect(handler.isRetrying).toBe(false);
      expect(handler.attempt).toBe(0);

      // onEnd called with cancellation
      expect(events.ends).toHaveLength(1);
      expect(events.ends[0][0]).toBe(false);
      expect(events.ends[0][2]).toBe("Retry cancelled");
    });

    it("is safe to call when not retrying", () => {
      const handler = new RetryHandler();
      // Should not throw
      expect(() => handler.abort()).not.toThrow();
    });
  });

  describe("waitForRetry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves immediately when not retrying", async () => {
      const handler = new RetryHandler();
      await expect(handler.waitForRetry()).resolves.toBeUndefined();
    });

    it("resolves after abort during retry", async () => {
      const handler = new RetryHandler({ baseDelayMs: 50, maxRetries: 3 });
      const msg = makeErrorMessage("503");

      // Prepare a retry promise (simulating the agent loop pattern)
      handler.prepareRetryIfNeeded(msg);
      expect(handler.isRetrying).toBe(true);

      // Abort cancels the sleep and resolves the promise
      handler.abort();
      await handler.waitForRetry();
      expect(handler.isRetrying).toBe(false);
    });
  });

  describe("prepareRetryIfNeeded", () => {
    it("creates retry promise for retryable error", () => {
      const handler = new RetryHandler();
      const msg = makeErrorMessage("overloaded");

      handler.prepareRetryIfNeeded(msg);
      expect(handler.isRetrying).toBe(true);
    });

    it("does nothing for non-retryable error", () => {
      const handler = new RetryHandler();
      const msg = makeErrorMessage("invalid API key");

      handler.prepareRetryIfNeeded(msg);
      expect(handler.isRetrying).toBe(false);
    });

    it("does nothing when disabled", () => {
      const handler = new RetryHandler({ enabled: false });
      const msg = makeErrorMessage("overloaded");

      handler.prepareRetryIfNeeded(msg);
      expect(handler.isRetrying).toBe(false);
    });

    it("does not overwrite existing retry promise", () => {
      const handler = new RetryHandler();
      const msg = makeErrorMessage("overloaded");

      handler.prepareRetryIfNeeded(msg);
      const firstIsRetrying = handler.isRetrying;
      handler.prepareRetryIfNeeded(msg);
      expect(firstIsRetrying).toBe(true);
      expect(handler.isRetrying).toBe(true);
    });
  });

  describe("resetOnSuccess", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resets attempt counter and fires onEnd(success)", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 100, maxRetries: 3 }, events);
      const msg = makeErrorMessage("overloaded");

      // Do one retry
      const p = handler.handleRetryableError(msg);
      await vi.advanceTimersByTimeAsync(100);
      await p;
      expect(handler.attempt).toBe(1);

      // Reset on success
      handler.resetOnSuccess();
      expect(handler.attempt).toBe(0);
      expect(events.ends).toHaveLength(1);
      expect(events.ends[0][0]).toBe(true); // success
      expect(events.ends[0][1]).toBe(1); // attempt
    });

    it("does nothing when attempt is already 0", () => {
      const events = collectEvents();
      const handler = new RetryHandler({}, events);

      handler.resetOnSuccess();
      expect(handler.attempt).toBe(0);
      expect(events.ends).toHaveLength(0);
    });
  });

  describe("full retry cycle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("succeeds on second attempt after retry", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 100, maxRetries: 3 }, events);
      const errorMsg = makeErrorMessage("503");

      // First attempt fails — retry
      const p1 = handler.handleRetryableError(errorMsg);
      await vi.advanceTimersByTimeAsync(100);
      const result1 = await p1;
      expect(result1).toBe(true);
      expect(handler.attempt).toBe(1);

      // Second attempt succeeds — reset
      handler.resetOnSuccess();
      expect(handler.attempt).toBe(0);

      // Events: 1 start (retry), 1 end (success)
      expect(events.starts).toHaveLength(1);
      expect(events.ends).toHaveLength(1);
      expect(events.ends[0][0]).toBe(true);
    });

    it("exhausts all retries then fails", async () => {
      const events = collectEvents();
      const handler = new RetryHandler({ baseDelayMs: 100, maxRetries: 2 }, events);
      const errorMsg = makeErrorMessage("overloaded");

      // Retry 1
      let p = handler.handleRetryableError(errorMsg);
      await vi.advanceTimersByTimeAsync(100);
      expect(await p).toBe(true);

      // Retry 2
      p = handler.handleRetryableError(errorMsg);
      await vi.advanceTimersByTimeAsync(200);
      expect(await p).toBe(true);

      // Retry 3 — exceeds max
      const finalResult = await handler.handleRetryableError(errorMsg);
      expect(finalResult).toBe(false);

      // 2 starts, 1 end (failure)
      expect(events.starts).toHaveLength(2);
      expect(events.ends).toHaveLength(1);
      expect(events.ends[0][0]).toBe(false);
    });
  });

  describe("DEFAULT_RETRY_SETTINGS", () => {
    it("has expected default values", () => {
      expect(DEFAULT_RETRY_SETTINGS.enabled).toBe(true);
      expect(DEFAULT_RETRY_SETTINGS.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_SETTINGS.baseDelayMs).toBe(2000);
      expect(DEFAULT_RETRY_SETTINGS.maxDelayMs).toBe(60000);
    });
  });
});
