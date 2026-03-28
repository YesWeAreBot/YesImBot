import type { Bot } from "koishi";

import { SessionManager } from "../session-manager";

export interface ChannelAgentOptions {
  bot: Bot;
  sessionManager: SessionManager;
  platform: string;
  channelId: string;
  modelId: string;
  judgeModel?: string;
  judgeEnabled?: boolean;
  judgeTimeoutMs?: number;
  basePath: string;
  instructions: string | (() => string | Promise<string>);
  streaming?: boolean;
  /** Maximum tool-call steps per response. Default 20. Per D-07. */
  maxSteps?: number;
  aggregationWindowMs?: number;
  /** Base response timeout in ms for cumulative timeout. Default 60000. Per D-05. */
  baseTimeoutMs?: number;
  /** Additional timeout in ms per allowed step. Default 30000. Per D-05. */
  perStepTimeoutMs?: number;
  /** Chunk timeout in ms for model streaming. Per D-01. */
  chunkTimeoutMs?: number;
  /** Model ID for compaction summarization. Falls back to main modelId if unset. Per D-05. */
  compactionModel?: string;
  /** Enable auto-compaction after responses. Default true. */
  compactionEnabled?: boolean;
  /** Tokens reserved for model output during compaction. Default 16384. Per D-03. */
  compactionReserveTokens?: number;
  /** Tokens of recent context to keep after compaction. Default 20000. Per D-02. */
  compactionKeepRecentTokens?: number;
  /** Context window size in tokens. Default 128000. */
  contextWindow?: number;
  sendMessageDirectly?: boolean;
  enableWorkspace?: boolean;
  enableSandbox?: boolean;
  enableFilesystem?: boolean;
  externalPath?: string | string[];
}

export type CompactionSkipReason = "empty-session" | "already-compacted" | "nothing-to-compact";

export interface CompactionRunResult {
  compacted: boolean;
  reason?: CompactionSkipReason;
  firstKeptEntryId?: string;
  summaryLength?: number;
  tokensBefore?: number;
}

export type ResponseState = "idle" | "responding" | "aborting" | "ended";
