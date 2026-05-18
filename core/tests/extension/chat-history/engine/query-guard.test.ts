import { describe, it, expect } from "vitest";

import { validateQuery } from "../../../../src/extension/chat-history/engine/query-guard.js";

describe("validateQuery", () => {
  it("rejects empty query", () => {
    const result = validateQuery({ query: "", where: "here" });
    expect(result.valid).toBe(false);
    expect(result.hint).toContain("关键词");
  });

  it("rejects single character query", () => {
    const result = validateQuery({ query: "a", where: "here" });
    expect(result.valid).toBe(false);
    expect(result.hint).toContain("具体");
  });

  it("rejects pure punctuation", () => {
    const result = validateQuery({ query: "...", where: "here" });
    expect(result.valid).toBe(false);
  });

  it("rejects whitespace-only query", () => {
    const result = validateQuery({ query: "   ", where: "here" });
    expect(result.valid).toBe(false);
  });

  it("accepts valid query", () => {
    const result = validateQuery({ query: "Docker 部署", where: "here" });
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("docker 部署");
  });

  it("normalizes whitespace", () => {
    const result = validateQuery({ query: "  hello   world  ", where: "here" });
    expect(result.normalized).toBe("hello world");
  });

  it("truncates long queries to 200 chars", () => {
    const longQuery = "a".repeat(300);
    const result = validateQuery({ query: longQuery, where: "here" });
    expect(result.valid).toBe(true);
    expect(result.normalized!.length).toBe(200);
  });

  it("rejects cross-channel search without filters", () => {
    const result = validateQuery({ query: "test", where: "all" });
    expect(result.valid).toBe(false);
    expect(result.hint).toContain("过滤条件");
  });

  it("accepts cross-channel search with user filter", () => {
    const result = validateQuery({ query: "test", where: "all", hasUserFilter: true });
    expect(result.valid).toBe(true);
  });

  it("accepts cross-channel search with time filter", () => {
    const result = validateQuery({ query: "test", where: "all", hasTimeFilter: true });
    expect(result.valid).toBe(true);
  });
});
