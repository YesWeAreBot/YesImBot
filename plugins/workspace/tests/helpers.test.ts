import { describe, it, expect } from "vitest";

import { stripAnsi, limitLines, formatLine } from "../src/tools/helpers";

describe("stripAnsi", () => {
  it("removes ANSI color codes", () => {
    expect(stripAnsi("\x1B[31mred\x1B[0m")).toBe("red");
  });

  it("removes multiple ANSI codes", () => {
    expect(stripAnsi("\x1B[1m\x1B[32mbold green\x1B[0m")).toBe("bold green");
  });

  it("returns plain string unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

describe("limitLines", () => {
  it("returns content unchanged when under limit", () => {
    const output = "line1\nline2\nline3";
    const result = limitLines(output, 10);
    expect(result).toEqual({ content: output, truncated: false, totalLines: 3 });
  });

  it("truncates when over limit", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const result = limitLines(lines.join("\n"), 5);
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(10);
    expect(result.content).toContain("showing 5 of 10 lines");
  });

  it("handles single line", () => {
    const result = limitLines("single", 5);
    expect(result).toEqual({ content: "single", truncated: false, totalLines: 1 });
  });
});

describe("formatLine", () => {
  it("formats with line numbers by default", () => {
    expect(formatLine("hello", 1, true)).toBe("     1→ hello");
  });

  it("returns content without line numbers when disabled", () => {
    expect(formatLine("hello", 1, false)).toBe("hello");
  });

  it("pads line numbers correctly", () => {
    expect(formatLine("x", 42, true)).toBe("    42→ x");
  });
});
