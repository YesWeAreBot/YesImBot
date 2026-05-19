import { describe, it, expect } from "vitest";

import { encodeChannelId } from "../../src/services/session/encoding.js";

describe("encodeChannelId", () => {
  it("should produce deterministic output for same input", () => {
    const a = encodeChannelId("onebot", "123456");
    const b = encodeChannelId("onebot", "123456");
    expect(a).toBe(b);
  });

  it("should produce different output for different inputs", () => {
    const a = encodeChannelId("onebot", "123456");
    const b = encodeChannelId("onebot", "789012");
    expect(a).not.toBe(b);
  });
});
