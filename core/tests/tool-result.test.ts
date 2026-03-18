import { describe, expect, it } from "vitest";

import { Failed, Success } from "../src/services/plugin/utils";

describe("tool result helpers", () => {
  it("Success returns strict ok/data shape", () => {
    const result = Success({ answer: 1 });

    expect(result).toEqual({ ok: true, data: { answer: 1 } });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("content");
  });

  it("Failed returns strict error shape with metadata", () => {
    const result = Failed("boom", { code: "E_TOOL" });

    expect(result).toEqual({
      ok: false,
      error: "boom",
      metadata: { code: "E_TOOL" },
    });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("content");
  });
});
