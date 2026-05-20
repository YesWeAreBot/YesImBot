import { describe, expect, it } from "vitest";

import { splitDeliverySegments } from "../../src/delivery/segmenter.js";

describe("splitDeliverySegments", () => {
  it("splits on <sep/> and returns raw segments", () => {
    const result = splitDeliverySegments("第一段<sep/>第二段<sep/>第三段", { seed: 1 });
    expect(result.rawSegments).toEqual(["第一段", "第二段", "第三段"]);
  });

  it("returns single segment when no <sep/> present", () => {
    const result = splitDeliverySegments("只有一段文本", { seed: 1 });
    expect(result.rawSegments).toEqual(["只有一段文本"]);
    expect(result.finalSegments).toEqual(["只有一段文本"]);
  });

  it("returns empty array for empty text", () => {
    const result = splitDeliverySegments("", { seed: 1 });
    expect(result.rawSegments).toEqual([]);
    expect(result.finalSegments).toEqual([]);
  });

  it("merges very short text into one segment", () => {
    // Total < 25 Chinese chars should merge into 1
    const result = splitDeliverySegments("短<sep/>文本", { seed: 1 });
    expect(result.finalSegments).toHaveLength(1);
  });

  it("produces 1-3 final segments with seed", () => {
    // Use a longer text to avoid short-text merging
    const text =
      "这是第一段比较长的文本<sep/>这是第二段比较长的文本<sep/>这是第三段比较长的文本<sep/>这是第四段比较长的文本";
    const result = splitDeliverySegments(text, { seed: 42 });
    expect(result.finalSegments.length).toBeGreaterThanOrEqual(1);
    expect(result.finalSegments.length).toBeLessThanOrEqual(3);
  });

  it("produces reproducible results with same seed", () => {
    const text = "第一段较长的文本内容<sep/>第二段较长的文本内容<sep/>第三段较长的文本内容";
    const result1 = splitDeliverySegments(text, { seed: 123 });
    const result2 = splitDeliverySegments(text, { seed: 123 });
    expect(result1.finalSegments).toEqual(result2.finalSegments);
  });

  it("produces different results with different seeds", () => {
    const text =
      "第一段较长的文本内容<sep/>第二段较长的文本内容<sep/>第三段较长的文本内容<sep/>第四段较长的文本内容";
    // Try multiple seed pairs - at least one should differ
    let foundDifferent = false;
    for (let seed = 1; seed <= 10; seed++) {
      const result1 = splitDeliverySegments(text, { seed });
      const result2 = splitDeliverySegments(text, { seed: seed + 100 });
      if (result1.finalSegments.length !== result2.finalSegments.length) {
        foundDifferent = true;
        break;
      }
    }
    // With enough attempts, we should see different segment counts
    // This is probabilistic but very likely with 10 attempts
    expect(foundDifferent).toBe(true);
  });

  it("preserves all content in final segments", () => {
    const text = "AAA<sep/>BBB<sep/>CCC";
    const result = splitDeliverySegments(text, { seed: 1 });
    const allContent = result.finalSegments.join("");
    // All original content should be preserved (just possibly merged)
    expect(allContent).toContain("AAA");
    expect(allContent).toContain("BBB");
    expect(allContent).toContain("CCC");
  });

  it("trims whitespace from segments", () => {
    const result = splitDeliverySegments("  第一段  <sep/>  第二段  ", { seed: 1 });
    expect(result.rawSegments[0]).toBe("第一段");
    expect(result.rawSegments[1]).toBe("第二段");
  });

  it("filters out empty segments", () => {
    const result = splitDeliverySegments("第一段<sep/><sep/>第三段", { seed: 1 });
    expect(result.rawSegments).toEqual(["第一段", "第三段"]);
  });
});
