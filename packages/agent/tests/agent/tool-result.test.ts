import { describe, it, expect } from "vitest";

import { normalizeToolResult } from "../../src/agent/agent-loop";

describe("normalizeToolResult", () => {
  it("should normalize simple object to json", () => {
    const result = normalizeToolResult({ temp: 25 });
    expect(result).toEqual({
      content: { type: "json", value: { temp: 25 } },
    });
  });

  it("should normalize number to json", () => {
    const result = normalizeToolResult(42);
    expect(result).toEqual({
      content: { type: "json", value: 42 },
    });
  });

  it("should normalize boolean to json", () => {
    const result = normalizeToolResult(true);
    expect(result).toEqual({
      content: { type: "json", value: true },
    });
  });

  it("should normalize string to text", () => {
    const result = normalizeToolResult("hello");
    expect(result).toEqual({
      content: { type: "text", value: "hello" },
    });
  });

  it("should pass through text ToolResultOutput", () => {
    const input = { type: "text", value: "hello" };
    const result = normalizeToolResult(input);
    expect(result).toEqual({
      content: { type: "text", value: "hello" },
    });
  });

  it("should pass through json ToolResultOutput", () => {
    const input = { type: "json", value: { temp: 25 } };
    const result = normalizeToolResult(input);
    expect(result).toEqual({
      content: { type: "json", value: { temp: 25 } },
    });
  });

  it("should handle {output, details} structure", () => {
    const input = {
      output: { temp: 25 },
      details: { source: "api" },
    };
    const result = normalizeToolResult(input);
    expect(result).toEqual({
      content: { type: "json", value: { temp: 25 } },
      details: { source: "api" },
    });
  });

  it("should handle {output, details} with text ToolResultOutput", () => {
    const input = {
      output: { type: "text", value: "temperature" },
      details: { source: "api" },
    };
    const result = normalizeToolResult(input);
    expect(result).toEqual({
      content: { type: "text", value: "temperature" },
      details: { source: "api" },
    });
  });

  it("should handle {output, details} with json ToolResultOutput", () => {
    const input = {
      output: { type: "json", value: { temp: 25 } },
      details: { source: "api", latency: 100 },
    };
    const result = normalizeToolResult(input);
    expect(result).toEqual({
      content: { type: "json", value: { temp: 25 } },
      details: { source: "api", latency: 100 },
    });
  });

  it("should not confuse ToolResultOutput with {output, details}", () => {
    const input = {
      type: "json",
      output: { temp: 25 },
      details: { source: "api" },
    };
    const result = normalizeToolResult(input);
    expect(result).toEqual({
      content: { type: "json", value: { output: { temp: 25 }, details: { source: "api" } } },
    });
  });
});
