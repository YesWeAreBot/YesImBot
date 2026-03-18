import { describe, it, expect, vi } from "vitest";

import { retryWithBackoff, isRetryableError } from "../src/utils/retry";

describe("retryWithBackoff", () => {
  it("should return result without retry on success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await retryWithBackoff(
      fn,
      { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, factor: 2 },
      isRetryableError,
    );

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable error with exponential delay", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("success");

    const result = await retryWithBackoff(
      fn,
      { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, factor: 2 },
      isRetryableError,
    );

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw immediately on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("400 Bad Request"));

    await expect(
      retryWithBackoff(
        fn,
        { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, factor: 2 },
        isRetryableError,
      ),
    ).rejects.toThrow("400 Bad Request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should throw last error when max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      retryWithBackoff(
        fn,
        { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000, factor: 2 },
        isRetryableError,
      ),
    ).rejects.toThrow("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should calculate delay with exponential backoff", async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValue("success");

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((cb: () => void, delay: number) => {
      delays.push(delay);
      return originalSetTimeout(cb, 0);
    }) as unknown as typeof setTimeout;

    await retryWithBackoff(
      fn,
      { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000, factor: 2 },
      isRetryableError,
    );

    global.setTimeout = originalSetTimeout;

    expect(delays.length).toBe(2);
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[0]).toBeLessThanOrEqual(1200);
    expect(delays[1]).toBeGreaterThanOrEqual(2000);
    expect(delays[1]).toBeLessThanOrEqual(2400);
  });

  it("should cap delay at maxDelayMs", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValue("success");

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((cb: () => void, delay: number) => {
      delays.push(delay);
      return originalSetTimeout(cb, 0);
    }) as unknown as typeof setTimeout;

    await retryWithBackoff(
      fn,
      { maxRetries: 2, baseDelayMs: 5000, maxDelayMs: 3000, factor: 2 },
      isRetryableError,
    );

    global.setTimeout = originalSetTimeout;

    expect(delays[0]).toBeLessThanOrEqual(3600);
  });
});

describe("isRetryableError", () => {
  it("should return true for timeout errors", () => {
    expect(isRetryableError(new Error("timeout"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("should return true for connection errors", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
  });

  it("should return true for 429 and 503 status codes", () => {
    expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("should return false for 400, 401, 403, 404 status codes", () => {
    expect(isRetryableError(new Error("400 Bad Request"))).toBe(false);
    expect(isRetryableError(new Error("401 Unauthorized"))).toBe(false);
    expect(isRetryableError(new Error("403 Forbidden"))).toBe(false);
    expect(isRetryableError(new Error("404 Not Found"))).toBe(false);
  });

  it("should return false by default", () => {
    expect(isRetryableError(new Error("Unknown error"))).toBe(false);
  });
});
