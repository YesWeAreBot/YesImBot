import type { LanguageModel } from "ai";

import type { TimelineRecord } from "../contracts";
import { materializeTimeline } from "../materialize";
import { findCutPoint, isCompactionRecordVisible } from "./cut-point";
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

function estimateSummaryTokens(summary: string | undefined): number {
  if (!summary) {
    return 0;
  }

  return Math.ceil(summary.length / 4);
}

function filterSummarizableRecords(records: readonly TimelineRecord[]): TimelineRecord[] {
  return records.filter((record) => isCompactionRecordVisible(record));
}

export function prepareCompaction(
  records: readonly TimelineRecord[],
  settings: CompactionSettings,
  previousSummary?: string,
  contextTokens?: number,
): CompactionPreparation | undefined {
  if (records.length === 0) {
    return undefined;
  }

  const visibleRecords = filterSummarizableRecords(records);
  const tokensBefore =
    estimateContextTokens(materializeTimeline(visibleRecords)) + estimateSummaryTokens(previousSummary);
  const ratio =
    contextTokens !== undefined && tokensBefore > 0 ? Math.max(1, contextTokens / tokensBefore) : 1;
  const effectiveKeepRecentTokens = Math.max(1, Math.floor(settings.keepRecentTokens / ratio));
  const cutPoint = findCutPoint(records, 0, records.length, effectiveKeepRecentTokens);
  const firstKeptRecord = records[cutPoint.firstKeptRecordIndex];

  if (!firstKeptRecord?.id) {
    return undefined;
  }

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptRecordIndex;
  const recordsToSummarize = filterSummarizableRecords(records.slice(0, Math.max(historyEnd, 0)));
  const turnPrefixRecords = cutPoint.isSplitTurn
    ? filterSummarizableRecords(records.slice(cutPoint.turnStartIndex, cutPoint.firstKeptRecordIndex))
    : [];

  if (
    recordsToSummarize.length === 0 &&
    turnPrefixRecords.length === 0 &&
    previousSummary === undefined
  ) {
    return undefined;
  }

  return {
    firstKeptEntryId: firstKeptRecord.id,
    recordsToSummarize,
    turnPrefixRecords,
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
    recordsToSummarize,
    turnPrefixRecords,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    settings,
  } = preparation;

  let summary: string;

  if (isSplitTurn && turnPrefixRecords.length > 0) {
    const [historySummary, turnPrefixSummary] = await Promise.all([
      recordsToSummarize.length > 0
        ? generateSummary(recordsToSummarize, model, settings.reserveTokens, signal, previousSummary)
        : Promise.resolve(previousSummary ?? "No prior history."),
      generateTurnPrefixSummary(turnPrefixRecords, model, settings.reserveTokens, signal),
    ]);

    summary = `${historySummary}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixSummary}`;
  } else {
    summary = await generateSummary(
      recordsToSummarize,
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
