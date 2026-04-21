import { convertToLlm } from "../materialize";
import type { SessionMessageEntry } from "../messages";
import { estimateContextTokens } from "./estimate";
import type { CompactionPreparation, CompactionSettings } from "./types";

function estimateSummaryTokens(summary: string | undefined): number {
  if (!summary) {
    return 0;
  }

  return Math.ceil(summary.length / 4);
}

function estimateEntryTokens(entry: SessionMessageEntry): number {
  return estimateContextTokens(convertToLlm([entry.message]));
}

function findFirstKeptIndex(
  entries: readonly SessionMessageEntry[],
  keepRecentTokens: number,
): number {
  if (entries.length <= 1) {
    return entries.length;
  }

  let keptTokens = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    keptTokens += estimateEntryTokens(entries[i]);
    if (keptTokens >= keepRecentTokens) {
      return i;
    }
  }

  return 0;
}

export function prepareCompaction(
  entries: readonly SessionMessageEntry[],
  settings: CompactionSettings,
  previousSummary?: string,
  contextTokens?: number,
): CompactionPreparation | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const messageHistory = entries.map((entry) => entry.message);
  const tokensBefore =
    estimateContextTokens(convertToLlm(messageHistory)) + estimateSummaryTokens(previousSummary);
  const ratio =
    contextTokens !== undefined && tokensBefore > 0 ? Math.max(1, contextTokens / tokensBefore) : 1;
  const effectiveKeepRecentTokens = Math.max(1, Math.floor(settings.keepRecentTokens / ratio));
  const firstKeptIndex = findFirstKeptIndex(entries, effectiveKeepRecentTokens);

  if (firstKeptIndex <= 0 || firstKeptIndex >= entries.length) {
    return undefined;
  }

  const firstKeptEntry = entries[firstKeptIndex];
  if (!firstKeptEntry?.id) {
    return undefined;
  }

  const entriesToSummarize = entries.slice(0, firstKeptIndex);
  if (entriesToSummarize.length === 0 && previousSummary === undefined) {
    return undefined;
  }

  return {
    firstKeptEntryId: firstKeptEntry.id,
    entriesToSummarize,
    turnPrefixEntries: [],
    isSplitTurn: false,
    tokensBefore,
    previousSummary,
    settings,
  };
}
