import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokenBucket } from "../willingness";

/**
 * Unit tests for WILL-02: TokenBucket rate limiter.
 *
 * RED until 23-03 implements the TokenBucket class in willingness.ts.
 * The import above will fail until the class is exported.
 */

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("consume returns true until capacity exhausted, then false", () => {
    const bucket = new TokenBucket(3, 1);

    expect(bucket.consume("user-1")).toBe(true);
    expect(bucket.consume("user-1")).toBe(true);
    expect(bucket.consume("user-1")).toBe(true);
    // 4th call exceeds capacity
    expect(bucket.consume("user-1")).toBe(false);
  });

  it("different keys have independent buckets", () => {
    const bucket = new TokenBucket(2, 1);

    // Exhaust key "a"
    expect(bucket.consume("a")).toBe(true);
    expect(bucket.consume("a")).toBe(true);
    expect(bucket.consume("a")).toBe(false);

    // Key "b" should still have full capacity
    expect(bucket.consume("b")).toBe(true);
    expect(bucket.consume("b")).toBe(true);
    expect(bucket.consume("b")).toBe(false);
  });

  it("refills over time", () => {
    const bucket = new TokenBucket(3, 1);

    // Exhaust the bucket
    bucket.consume("user-1");
    bucket.consume("user-1");
    bucket.consume("user-1");
    expect(bucket.consume("user-1")).toBe(false);

    // Advance 2 seconds — should refill 2 tokens (rate = 1/s)
    vi.advanceTimersByTime(2000);

    expect(bucket.consume("user-1")).toBe(true);
  });
});
