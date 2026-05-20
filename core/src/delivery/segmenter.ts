import { mulberry32 } from "./random.js";
import type { DeliverySegmentPlan } from "./types.js";

interface SegmenterOptions {
  /** Seed for reproducible random merging */
  seed?: number;
  /** Segments shorter than this (in Chinese chars) are merged into neighbors */
  shortSegmentChars?: number;
  /** If total text is shorter than this, merge everything into one segment */
  shortTextChars?: number;
  /** Probability weights for target segment count */
  targetCountWeights?: { one: number; two: number; three: number };
}

/**
 * Count Chinese characters in a string (CJK Unified Ideographs + common punctuation).
 */
function countChineseChars(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    // CJK Unified Ideographs range + common CJK punctuation
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Split assistant text by <sep/> and apply random merging to produce 1-3 final segments.
 *
 * Rules:
 * 1. Split on <sep/> token
 * 2. Short segments (< shortSegmentChars Chinese chars) merge into adjacent segments
 * 3. If total text is short (< shortTextChars Chinese chars), merge everything into 1 segment
 * 4. Randomly merge to target 1-3 segments with given weights
 * 5. Never split a segment again after merging
 */
export function splitDeliverySegments(
  text: string,
  options?: SegmenterOptions,
): DeliverySegmentPlan {
  const {
    seed,
    shortSegmentChars = 6,
    shortTextChars = 25,
    targetCountWeights = { one: 0.45, two: 0.4, three: 0.15 },
  } = options ?? {};

  const random = seed !== undefined ? mulberry32(seed) : Math.random;

  // Step 1: Split on <sep/>
  const rawSegments = text
    .split(/<sep\/>/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // If no segments or only one, return as-is
  if (rawSegments.length <= 1) {
    return { rawSegments, finalSegments: [...rawSegments] };
  }

  // Step 2: Check if total text is very short
  const totalChineseChars = rawSegments.reduce((sum, seg) => sum + countChineseChars(seg), 0);
  if (totalChineseChars < shortTextChars) {
    const merged = rawSegments.join("");
    return { rawSegments, finalSegments: [merged] };
  }

  // Step 3: Merge short segments into neighbors
  let workingSegments = [...rawSegments];
  let i = 0;
  while (i < workingSegments.length) {
    if (countChineseChars(workingSegments[i]) < shortSegmentChars) {
      if (workingSegments.length === 1) break;

      if (i === 0) {
        // Merge with next
        workingSegments[1] = workingSegments[0] + workingSegments[1];
        workingSegments.shift();
      } else if (i === workingSegments.length - 1) {
        // Merge with previous
        workingSegments[i - 1] = workingSegments[i - 1] + workingSegments[i];
        workingSegments.pop();
        i--;
      } else {
        // Merge with the shorter neighbor
        const prevLen = countChineseChars(workingSegments[i - 1]);
        const nextLen = countChineseChars(workingSegments[i + 1]);
        if (prevLen <= nextLen) {
          workingSegments[i - 1] = workingSegments[i - 1] + workingSegments[i];
          workingSegments.splice(i, 1);
          i--;
        } else {
          workingSegments[i + 1] = workingSegments[i] + workingSegments[i + 1];
          workingSegments.splice(i, 1);
        }
      }
    } else {
      i++;
    }
  }

  // If after merging short segments we only have 1, return
  if (workingSegments.length <= 1) {
    return { rawSegments, finalSegments: workingSegments };
  }

  // Step 4: Random merge to target count (1-3)
  const targetCount = pickTargetCount(random, targetCountWeights, workingSegments.length);

  while (workingSegments.length > targetCount) {
    // Find the pair of adjacent segments with the shortest combined length
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let j = 0; j < workingSegments.length - 1; j++) {
      const combinedLen =
        countChineseChars(workingSegments[j]) + countChineseChars(workingSegments[j + 1]);
      if (combinedLen < bestLen) {
        bestLen = combinedLen;
        bestIdx = j;
      }
    }
    // Merge the pair
    workingSegments[bestIdx] = workingSegments[bestIdx] + workingSegments[bestIdx + 1];
    workingSegments.splice(bestIdx + 1, 1);
  }

  return { rawSegments, finalSegments: workingSegments };
}

/**
 * Pick target segment count (1-3) based on weights, capped by actual segment count.
 */
function pickTargetCount(
  random: () => number,
  weights: { one: number; two: number; three: number },
  maxCount: number,
): number {
  const r = random();
  let cumulative = 0;

  cumulative += weights.one;
  if (r < cumulative || maxCount <= 1) return 1;

  cumulative += weights.two;
  if (r < cumulative || maxCount <= 2) return Math.min(2, maxCount);

  return Math.min(3, maxCount);
}
