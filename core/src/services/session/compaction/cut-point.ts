import type { TimelineRecord } from "../types/index";
import type { CutPointResult } from "./types";

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function isRecordVisibleForCompaction(record: TimelineRecord): boolean {
  if (record.visibility !== "model") {
    return false;
  }

  if (record.materialization === "hidden" || record.materialization === "internal") {
    return false;
  }

  return record.kind !== "state_change";
}

function isValidCutPoint(record: TimelineRecord): boolean {
  if (!isRecordVisibleForCompaction(record)) {
    return false;
  }

  return (
    record.kind === "channel_message" ||
    record.kind === "channel_event" ||
    record.kind === "assistant_message" ||
    record.kind === "tool_message"
  );
}

function isTurnStartRecord(record: TimelineRecord): boolean {
  return isRecordVisibleForCompaction(record) && record.kind === "channel_message";
}

function estimateRecordTokens(record: TimelineRecord): number {
  if (!isRecordVisibleForCompaction(record)) {
    return 0;
  }

  switch (record.kind) {
    case "channel_message":
      return charsToTokens(record.message.content.length);
    case "channel_event":
      return charsToTokens(
        record.event.eventType.length +
          record.event.platform.length +
          record.event.channelId.length +
          (record.event.sourceUserId?.length ?? 0),
      );
    case "assistant_message": {
      const { content } = record.message;
      if (typeof content === "string") {
        return charsToTokens(content.length);
      }

      let chars = 0;
      for (const part of content) {
        if (part.type === "text" || part.type === "reasoning") {
          if (typeof part.text === "string") {
            chars += part.text.length;
          }
          continue;
        }

        if (part.type === "tool-call") {
          chars += part.toolName.length + JSON.stringify("input" in part ? part.input : {}).length;
        }
      }

      return charsToTokens(chars);
    }
    case "tool_message": {
      let chars = 0;
      for (const part of record.message.content) {
        chars += JSON.stringify("output" in part ? part.output : part).length;
      }
      return charsToTokens(chars);
    }
    case "system_notice":
      return charsToTokens(record.notice.length);
    case "state_change":
      return 0;
  }
}

export function findTurnStartIndex(
  records: readonly TimelineRecord[],
  recordIndex: number,
  startIndex: number,
): number {
  for (let i = recordIndex; i >= startIndex; i--) {
    if (isTurnStartRecord(records[i])) {
      return i;
    }
  }

  return -1;
}

export function findCutPoint(
  records: readonly TimelineRecord[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const validCutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    if (isValidCutPoint(records[i])) {
      validCutPoints.push(i);
    }
  }

  if (validCutPoints.length === 0) {
    return {
      firstKeptRecordIndex: startIndex,
      turnStartIndex: -1,
      isSplitTurn: false,
    };
  }

  let accumulatedTokens = 0;
  let cutIndex = validCutPoints[0];

  for (let i = endIndex - 1; i >= startIndex; i--) {
    accumulatedTokens += estimateRecordTokens(records[i]);
    if (accumulatedTokens >= keepRecentTokens) {
      let fallbackCutPoint = cutIndex;
      for (const cutPoint of validCutPoints) {
        if (cutPoint < i) {
          continue;
        }

        fallbackCutPoint = cutPoint;
        if (records[cutPoint].kind !== "tool_message") {
          cutIndex = cutPoint;
          break;
        }
      }

      if (records[cutIndex].kind === "tool_message") {
        cutIndex = fallbackCutPoint;
      }

      break;
    }
  }

  const cutRecord = records[cutIndex];
  const turnStartIndex = isTurnStartRecord(cutRecord)
    ? -1
    : findTurnStartIndex(records, cutIndex, startIndex);

  return {
    firstKeptRecordIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: turnStartIndex !== -1,
  };
}

export function isCompactionRecordVisible(record: TimelineRecord): boolean {
  return isRecordVisibleForCompaction(record);
}
