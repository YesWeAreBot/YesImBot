import type { LanguageModel } from "ai";

import type { SessionMessageEntry } from "../types";
import { prepareCompaction } from "./prepare";
import { generateSummary, generateTurnPrefixSummary } from "./summarize";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "./types";

export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  return settings.enabled && contextTokens > contextWindow - settings.reserveTokens;
}

export { prepareCompaction };

function entriesToSessionMessages(entries: readonly SessionMessageEntry[]) {
  return entries.map((entry) => entry.message);
}

export async function compact(
  preparation: CompactionPreparation,
  model: LanguageModel,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    entriesToSummarize,
    turnPrefixEntries,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    settings,
  } = preparation;

  let summary: string;

  if (isSplitTurn && turnPrefixEntries.length > 0) {
    const [historySummary, turnPrefixSummary] = await Promise.all([
      entriesToSummarize.length > 0
        ? generateSummary(
            entriesToSessionMessages(entriesToSummarize),
            model,
            settings.reserveTokens,
            signal,
            previousSummary,
          )
        : Promise.resolve(previousSummary ?? "No prior history."),
      generateTurnPrefixSummary(
        entriesToSessionMessages(turnPrefixEntries),
        model,
        settings.reserveTokens,
        signal,
      ),
    ]);

    summary = `${historySummary}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixSummary}`;
  } else {
    summary = await generateSummary(
      entriesToSessionMessages(entriesToSummarize),
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
