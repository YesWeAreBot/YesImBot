import type { SessionEntry } from "../session-manager";
import { estimateTokens } from "./estimate";
import type { CutPointResult } from "./types";

function isValidCutPoint(entry: SessionEntry): boolean {
  if (entry.type === "custom_message") {
    return true;
  }
  if (entry.type === "message") {
    return entry.message.role === "user" || entry.message.role === "assistant";
  }
  return false;
}

function isTurnStartEntry(entry: SessionEntry): boolean {
  if (entry.type === "custom_message") {
    return true;
  }
  if (entry.type === "message") {
    return entry.message.role === "user";
  }
  return false;
}

function estimateEntryTokens(entry: SessionEntry): number {
  if (entry.type === "message") {
    return estimateTokens(entry.message);
  }
  if (entry.type === "custom_message") {
    if (typeof entry.content === "string") {
      return Math.ceil(entry.content.length / 4);
    }
    let chars = 0;
    for (const part of entry.content) {
      if (part.type === "text") {
        chars += part.text.length;
      } else {
        chars += 256;
      }
    }
    return Math.ceil(chars / 4);
  }
  if (entry.type === "compaction") {
    return Math.ceil(entry.summary.length / 4);
  }
  return 0;
}

export function findTurnStartIndex(
  entries: SessionEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    if (isTurnStartEntry(entries[i])) {
      return i;
    }
  }
  return -1;
}

export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const validCutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    if (isValidCutPoint(entries[i])) {
      validCutPoints.push(i);
    }
  }

  if (validCutPoints.length === 0) {
    return {
      firstKeptEntryIndex: startIndex,
      turnStartIndex: -1,
      isSplitTurn: false,
    };
  }

  let accumulatedTokens = 0;
  let cutIndex = validCutPoints[0];

  for (let i = endIndex - 1; i >= startIndex; i--) {
    accumulatedTokens += estimateEntryTokens(entries[i]);
    if (accumulatedTokens >= keepRecentTokens) {
      for (const cutPoint of validCutPoints) {
        if (cutPoint >= i) {
          cutIndex = cutPoint;
          break;
        }
      }
      break;
    }
  }

  while (cutIndex > startIndex) {
    const prev = entries[cutIndex - 1];
    if (prev.type === "compaction") {
      break;
    }
    if (prev.type === "message" || prev.type === "custom_message") {
      break;
    }
    cutIndex--;
  }

  const cutEntry = entries[cutIndex];
  const isUserOrCustomStart = isTurnStartEntry(cutEntry);
  const turnStartIndex = isUserOrCustomStart
    ? -1
    : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserOrCustomStart && turnStartIndex !== -1,
  };
}
