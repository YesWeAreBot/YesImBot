import type { TimelineRecord } from "../contracts";

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface CutPointResult {
  firstKeptRecordIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

export interface CompactionPreparation {
  firstKeptEntryId: string;
  recordsToSummarize: TimelineRecord[];
  turnPrefixRecords: TimelineRecord[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  settings: CompactionSettings;
}

export interface CompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}
