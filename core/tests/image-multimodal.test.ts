import { describe, it, expect, beforeEach } from "vitest";

import type { ImageConfig } from "../src/services/horizon/types";

// Simple h.parse mock for testing
const hParse = (text: string) => {
  const elements: Array<{ type: string; attrs: Record<string, string>; toString: () => string }> =
    [];
  const imgRegex = /<img([^>]*)\/>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      elements.push({ type: "text", attrs: { content: textContent }, toString: () => textContent });
    }
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    elements.push({ type: "img", attrs, toString: () => "" });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const textContent = text.slice(lastIndex);
    elements.push({ type: "text", attrs: { content: textContent }, toString: () => textContent });
  }
  return elements;
};

describe("Image Multimodal Conversion", () => {
  let imageCache: Map<string, { base64: string; mediaType: string; status: string }>;
  let lifecycleTracker: Map<string, number>;

  const buildUserContent = (
    texts: string[],
    imageConfig: ImageConfig,
  ): string | Array<{ type: string; text?: string; image?: string; mediaType?: string }> => {
    if (imageConfig.imageMode !== "native") return texts.join("\n");

    type Candidate = { id: string; base64: string; mediaType: string; textIdx: number };
    const processedTexts: string[] = [];
    const allCandidates: Candidate[] = [];
    const maxImages = imageConfig.maxImagesInContext;
    const maxLifecycle = imageConfig.imageLifecycleCount;

    for (let i = 0; i < texts.length; i++) {
      const elements = hParse(texts[i]);
      const imgElements = elements.filter((el) => el.type === "img");
      const textElements = elements.filter((el) => el.type !== "img");

      for (const el of imgElements) {
        const id = el.attrs.id as string | undefined;
        const status = el.attrs.status as string | undefined;
        if (!id) continue;

        const entry = imageCache.get(id);
        if (!entry) continue;
        if (entry.status === "failed" || status === "failed") continue;

        const count = lifecycleTracker.get(id) ?? 0;
        if (count >= maxLifecycle) continue;

        allCandidates.push({ id, base64: entry.base64, mediaType: entry.mediaType, textIdx: i });
      }
      processedTexts.push(textElements.map((el) => el.toString()).join(""));
    }

    const keepFrom = Math.max(0, allCandidates.length - maxImages);
    const parts: Array<{ type: string; text?: string; image?: string; mediaType?: string }> = [];
    let candidateIdx = 0;

    for (let i = 0; i < processedTexts.length; i++) {
      parts.push({ type: "text", text: processedTexts[i] });
      while (candidateIdx < allCandidates.length && allCandidates[candidateIdx].textIdx === i) {
        const c = allCandidates[candidateIdx];
        if (candidateIdx >= keepFrom) {
          lifecycleTracker.set(c.id, (lifecycleTracker.get(c.id) ?? 0) + 1);
          parts.push({ type: "text", text: `\nThe following is an image with ID #${c.id}:\n` });
          parts.push({ type: "image", image: c.base64, mediaType: c.mediaType });
        }
        candidateIdx++;
      }
    }

    if (parts.length === 1 && parts[0].type === "text") return parts[0].text!;
    return parts;
  };

  beforeEach(() => {
    imageCache = new Map([
      [
        "abc123",
        { base64: "data:image/jpeg;base64,/9j/4AAQ", mediaType: "image/jpeg", status: "ready" },
      ],
      [
        "def456",
        { base64: "data:image/png;base64,iVBORw0KGgo", mediaType: "image/png", status: "ready" },
      ],
      ["ghi789", { base64: "", mediaType: "", status: "failed" }],
      ["aaa", { base64: "data:image/jpeg;base64,AAA", mediaType: "image/jpeg", status: "ready" }],
      ["bbb", { base64: "data:image/png;base64,BBB", mediaType: "image/png", status: "ready" }],
    ]);
    lifecycleTracker = new Map();
  });

  it("should convert img tags with multiple attributes to UserContent", () => {
    const msgText = '<msg id="15">User: <img summary="" file="test.jpg" id="abc123"/></msg>';
    const result = buildUserContent([msgText], {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    });

    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string; text?: string; image?: string }>;
    expect(parts.some((p) => p.type === "image" && p.image?.includes("/9j/4AAQ"))).toBe(true);
  });

  it("should convert img tags with id-only to UserContent", () => {
    const msgText = '<msg id="16">User: <img id="def456"/></msg>';
    const result = buildUserContent([msgText], {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    });

    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string; image?: string }>;
    expect(parts.some((p) => p.type === "image")).toBe(true);
  });

  it("should handle failed images gracefully", () => {
    const msgText = '<msg id="17">User: <img id="ghi789" status="failed"/></msg>';
    const result = buildUserContent([msgText], {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    });

    const parts = Array.isArray(result) ? result : [{ type: "text", text: result }];
    expect(parts.every((p) => p.type !== "image")).toBe(true);
  });

  it("should handle multiple images with different attributes", () => {
    const msgText =
      '<msg id="18">User: <img id="aaa" file="1.jpg"/> and <img id="bbb" summary="test"/></msg>';
    const result = buildUserContent([msgText], {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    });

    expect(Array.isArray(result)).toBe(true);
    const parts = result as Array<{ type: string; image?: string }>;
    const imageParts = parts.filter((p) => p.type === "image");
    expect(imageParts.length).toBe(2);
  });

  it("should return string when no images present", () => {
    const msgText = '<msg id="19">User: plain text message</msg>';
    const result = buildUserContent([msgText], {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    });

    expect(typeof result).toBe("string");
  });
});
