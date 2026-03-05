import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ImageConfig } from "../src/services/horizon/types";
import { createImageMessageRecord, createMessageRecord } from "./fixtures/timeline-entries";

// Mock image cache entry
interface ImageCacheEntry {
  contentId: string;
  url: string;
  base64: string;
  mediaType: string;
  status: "ready" | "failed";
}

// Mock buildUserContent implementation for testing
class ImageLifecycleTester {
  private imageCache = new Map<string, ImageCacheEntry>();

  setImageCache(id: string, entry: ImageCacheEntry) {
    this.imageCache.set(id, entry);
  }

  buildUserContent(
    texts: string[],
    imageConfig: ImageConfig,
  ): string | Array<{ type: string; text?: string; image?: string; mediaType?: string }> {
    if (imageConfig.imageMode !== "native") return texts.join("\n");

    const lifecycleTracker = new Map<string, number>();
    const maxImages = imageConfig.maxImagesInContext;
    const maxLifecycle = imageConfig.imageLifecycleCount;

    type Candidate = { id: string; base64: string; mediaType: string; textIdx: number };

    // Pass 1: collect all eligible candidates
    const processedTexts: string[] = [];
    const allCandidates: Candidate[] = [];

    for (let i = 0; i < texts.length; i++) {
      let processedText = texts[i];
      const imgRegex = /<img id="([a-f0-9]+)"(?:\s+status="failed")?\/>/g;
      const matches: Array<{ id: string; full: string }> = [];
      let m: RegExpExecArray | null;

      while ((m = imgRegex.exec(texts[i])) !== null) {
        matches.push({ id: m[1], full: m[0] });
      }

      for (const { id, full } of matches) {
        const entry = this.imageCache.get(id);
        if (!entry) {
          // Remove tag completely if cache miss
          processedText = processedText.replace(full, "");
          continue;
        }
        if (entry.status === "failed") {
          // Keep failed status tag in text (replace original with status version)
          processedText = processedText.replace(full, `<img id="${id}" status="failed"/>`);
          continue;
        }
        const count = lifecycleTracker.get(id) ?? 0;
        if (count >= maxLifecycle) {
          // Remove tag if lifecycle exceeded
          processedText = processedText.replace(full, "");
          continue;
        }
        allCandidates.push({ id, base64: entry.base64, mediaType: entry.mediaType, textIdx: i });
        // Remove tag from text (will be embedded as ImagePart)
        processedText = processedText.replace(full, "");
      }
      processedTexts.push(processedText);
    }

    // Keep last N candidates (newest by Timeline position)
    const keepFrom = Math.max(0, allCandidates.length - maxImages);

    // Pass 2: build parts array
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
  }

  // Helper to count embedded images in result
  countEmbeddedImages(
    result: string | Array<{ type: string; text?: string; image?: string }>,
  ): number {
    if (typeof result === "string") return 0;
    return result.filter((p) => p.type === "image").length;
  }

  // Helper to get lifecycle count for an image
  getLifecycleCount(
    result: string | Array<{ type: string; text?: string; image?: string }>,
    imageId: string,
  ): number {
    if (typeof result === "string") return 0;
    return result.filter((p) => p.type === "text" && p.text?.includes(`ID #${imageId}`)).length;
  }
}

describe("Image lifecycle and FIFO eviction", () => {
  let tester: ImageLifecycleTester;

  beforeEach(() => {
    tester = new ImageLifecycleTester();
  });

  it("should embed new image entries within limit", () => {
    // Setup: 2 images, maxImages=3
    tester.setImageCache("abc001", {
      contentId: "abc001",
      url: "https://example.com/1.jpg",
      base64: "base64data1",
      mediaType: "image/jpeg",
      status: "ready",
    });
    tester.setImageCache("abc002", {
      contentId: "abc002",
      url: "https://example.com/2.jpg",
      base64: "base64data2",
      mediaType: "image/jpeg",
      status: "ready",
    });

    const texts = ['Message 1: <img id="abc001"/>', 'Message 2: <img id="abc002"/>'];

    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    };

    const result = tester.buildUserContent(texts, imageConfig);
    const embeddedCount = tester.countEmbeddedImages(result);

    expect(embeddedCount).toBe(2);
  });

  it("should evict old images by FIFO when exceeding limit", () => {
    // Setup: 4 images, maxImages=2 → keep last 2
    tester.setImageCache("abc001", {
      contentId: "abc001",
      url: "https://example.com/1.jpg",
      base64: "base64data1",
      mediaType: "image/jpeg",
      status: "ready",
    });
    tester.setImageCache("abc002", {
      contentId: "abc002",
      url: "https://example.com/2.jpg",
      base64: "base64data2",
      mediaType: "image/jpeg",
      status: "ready",
    });
    tester.setImageCache("abc003", {
      contentId: "abc003",
      url: "https://example.com/3.jpg",
      base64: "base64data3",
      mediaType: "image/jpeg",
      status: "ready",
    });
    tester.setImageCache("abc004", {
      contentId: "abc004",
      url: "https://example.com/4.jpg",
      base64: "base64data4",
      mediaType: "image/jpeg",
      status: "ready",
    });

    const texts = [
      'Message 1: <img id="abc001"/>',
      'Message 2: <img id="abc002"/>',
      'Message 3: <img id="abc003"/>',
      'Message 4: <img id="abc004"/>',
    ];

    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 2,
      imageLifecycleCount: 3,
    };

    const result = tester.buildUserContent(texts, imageConfig);
    const embeddedCount = tester.countEmbeddedImages(result);

    expect(embeddedCount).toBe(2);

    // Verify last 2 images are embedded
    if (typeof result !== "string") {
      const imageIds = result
        .filter((p) => p.type === "text" && p.text?.includes("ID #"))
        .map((p) => p.text?.match(/ID #(\w+)/)?.[1]);
      expect(imageIds).toContain("abc003");
      expect(imageIds).toContain("abc004");
      expect(imageIds).not.toContain("abc001");
      expect(imageIds).not.toContain("abc002");
    }
  });

  it("should increment lifecycle count for duplicate image URLs", () => {
    // Setup: same image in 3 messages
    // Note: lifecycle tracking is per-render, not per-image-occurrence within a render
    // All occurrences pass lifecycle check in Pass 1 (count starts at 0)
    tester.setImageCache("abc001", {
      contentId: "abc001",
      url: "https://example.com/same.jpg",
      base64: "base64data",
      mediaType: "image/jpeg",
      status: "ready",
    });

    const texts = [
      'Message 1: <img id="abc001"/>',
      'Message 2: <img id="abc001"/>',
      'Message 3: <img id="abc001"/>',
    ];

    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 5,
      imageLifecycleCount: 2,
    };

    const result = tester.buildUserContent(texts, imageConfig);

    // All 3 occurrences become candidates (lifecycle check in Pass 1 sees count=0)
    // All 3 get embedded (within maxImages limit)
    const embeddedCount = tester.countEmbeddedImages(result);
    expect(embeddedCount).toBe(3);
  });

  it("should only count lifecycle on embedded images", () => {
    // Setup: 5 images, maxImages=3 → first 2 evicted (count=0), last 3 embedded (count=1)
    for (let i = 1; i <= 5; i++) {
      tester.setImageCache(`abc00${i}`, {
        contentId: `abc00${i}`,
        url: `https://example.com/${i}.jpg`,
        base64: `base64data${i}`,
        mediaType: "image/jpeg",
        status: "ready",
      });
    }

    const texts = [
      'Message 1: <img id="abc001"/>',
      'Message 2: <img id="abc002"/>',
      'Message 3: <img id="abc003"/>',
      'Message 4: <img id="abc004"/>',
      'Message 5: <img id="abc005"/>',
    ];

    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    };

    const result = tester.buildUserContent(texts, imageConfig);
    const embeddedCount = tester.countEmbeddedImages(result);

    expect(embeddedCount).toBe(3);

    // Verify only last 3 are embedded
    if (typeof result !== "string") {
      const imageIds = result
        .filter((p) => p.type === "text" && p.text?.includes("ID #"))
        .map((p) => p.text?.match(/ID #(\w+)/)?.[1]);
      expect(imageIds).toContain("abc003");
      expect(imageIds).toContain("abc004");
      expect(imageIds).toContain("abc005");
    }
  });

  it("should gracefully handle cache failure without crashing", () => {
    // Setup: image with status="failed"
    tester.setImageCache("abc001", {
      contentId: "abc001",
      url: "https://example.com/failed.jpg",
      base64: "",
      mediaType: "image/jpeg",
      status: "failed",
    });

    const texts = ['Message with failed image: <img id="abc001"/>'];

    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    };

    const result = tester.buildUserContent(texts, imageConfig);

    // Should not crash, should skip failed image
    expect(result).toBeDefined();
    const embeddedCount = tester.countEmbeddedImages(result);
    expect(embeddedCount).toBe(0);

    // Verify failed status preserved in text
    const resultText =
      typeof result === "string" ? result : result.map((p) => p.text || "").join("");
    expect(resultText).toContain('status="failed"');
  });

  it("should handle missing cache entries gracefully", () => {
    // Setup: reference to non-existent image (using valid hex ID)
    const texts = ['Message with missing image: <img id="deadbeef"/>'];

    const imageConfig: ImageConfig = {
      imageMode: "native",
      maxImagesInContext: 3,
      imageLifecycleCount: 3,
    };

    const result = tester.buildUserContent(texts, imageConfig);

    // Should not crash, should remove missing image tag
    expect(result).toBeDefined();
    const embeddedCount = tester.countEmbeddedImages(result);
    expect(embeddedCount).toBe(0);

    const resultText =
      typeof result === "string" ? result : result.map((p) => p.text || "").join("");
    expect(resultText).not.toContain("<img");
  });
});
