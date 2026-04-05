import type { LanguageModel } from "ai";

import type { AgentMessage, SessionEntry } from "../session-manager";
import { findCutPoint } from "./cut-point";
import { estimateContextTokens } from "./estimate";
import { generateSummary, generateTurnPrefixSummary } from "./summarize";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "./types";

export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  return settings.enabled && contextTokens > contextWindow - settings.reserveTokens;
}

function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "custom_message") {
    if (
      entry.customType === "protocol_guidance" ||
      entry.customType.startsWith("protocol_") ||
      entry.customType.startsWith("control_")
    ) {
      return undefined;
    }

    return {
      role: "custom",
      customType: entry.customType,
      content: entry.content,
      details: entry.details,
      display: entry.display,
      timestamp: Date.parse(entry.timestamp),
    };
  }
  return undefined;
}

export function prepareCompaction(
  entries: SessionEntry[],
  settings: CompactionSettings,
  contextTokens?: number,
): CompactionPreparation | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  if (entries[entries.length - 1].type === "compaction") {
    return undefined;
  }

  let previousCompactionIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "compaction") {
      previousCompactionIndex = i;
      break;
    }
  }

  const boundaryStart = previousCompactionIndex + 1;
  const boundaryEnd = entries.length;

  const usageStart = previousCompactionIndex >= 0 ? previousCompactionIndex : 0;
  const usageMessages: AgentMessage[] = [];
  for (let i = usageStart; i < boundaryEnd; i++) {
    const message = getMessageFromEntry(entries[i]);
    if (message) {
      usageMessages.push(message);
    }
  }
  const tokensBefore = estimateContextTokens(usageMessages);
  const ratio =
    contextTokens !== undefined && tokensBefore > 0 ? Math.max(1, contextTokens / tokensBefore) : 1;
  const effectiveKeepRecentTokens = Math.max(1, Math.floor(settings.keepRecentTokens / ratio));

  const cutPoint = findCutPoint(entries, boundaryStart, boundaryEnd, effectiveKeepRecentTokens);

  const firstKeptEntry = entries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return undefined;
  }

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const message = getMessageFromEntry(entries[i]);
    if (message) {
      messagesToSummarize.push(message);
    }
  }

  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const message = getMessageFromEntry(entries[i]);
      if (message) {
        turnPrefixMessages.push(message);
      }
    }
  }

  let previousSummary: string | undefined;
  if (previousCompactionIndex >= 0) {
    const previousCompaction = entries[previousCompactionIndex];
    if (previousCompaction.type === "compaction") {
      previousSummary = previousCompaction.summary;
    }
  }

  if (
    messagesToSummarize.length === 0 &&
    turnPrefixMessages.length === 0 &&
    previousSummary === undefined
  ) {
    return undefined;
  }

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    settings,
  };
}

export async function compact(
  preparation: CompactionPreparation,
  model: LanguageModel,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    settings,
  } = preparation;

  let summary: string;

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    const [historySummary, turnPrefixSummary] = await Promise.all([
      messagesToSummarize.length > 0
        ? generateSummary(
            messagesToSummarize,
            model,
            settings.reserveTokens,
            signal,
            previousSummary,
          )
        : Promise.resolve("No prior history."),
      generateTurnPrefixSummary(turnPrefixMessages, model, settings.reserveTokens, signal),
    ]);

    summary = `${historySummary}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixSummary}`;
  } else {
    summary = await generateSummary(
      messagesToSummarize,
      model,
      settings.reserveTokens,
      signal,
      previousSummary,
    );
  }

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
  };
}
