import type { Bot } from "koishi";

import type { SessionManager } from "../session-manager";
import type { ChannelTurnOutcome } from "../types";

export interface ChannelAgentSettingsManager {
  reload(): import("../settings-manager").SettingsReloadMetadata;
  getReloadMetadata(): import("../settings-manager").SettingsReloadMetadata;
  getModel(): string | undefined;
  getJudgeSettings(): {
    model?: string;
    enabled?: boolean;
    timeoutMs?: number;
  } | undefined;
  getCompactionSettings(): {
    model?: string;
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
    contextWindow?: number;
  } | undefined;
  getResponseSettings(): {
    streaming?: boolean;
    maxSteps?: number;
    baseTimeoutMs?: number;
    perStepTimeoutMs?: number;
    chunkTimeoutMs?: number;
  } | undefined;
  getWorkspaceSettings(): {
    enableWorkspace?: boolean;
    enableSandbox?: boolean;
    enableFilesystem?: boolean;
    externalPath?: string[];
  } | undefined;
  getBuiltInInstructions(fallback?: string): string | undefined;
  getPromptResourceFilenames(fallback?: string[]): string[] | undefined;
}

export interface ChannelAgentOptions {
  bot?: Bot;
  sessionManager: SessionManager;
  settingsManager: ChannelAgentSettingsManager;
  platform: string;
  channelId: string;
  basePath: string;
  aggregationWindowMs?: number;
}

export type CompactionSkipReason = "empty-session" | "already-compacted" | "nothing-to-compact";

export interface CompactionRunResult {
  compacted: boolean;
  reason?: CompactionSkipReason;
  firstKeptEntryId?: string;
  summaryLength?: number;
  tokensBefore?: number;
}

export interface MergedFollowUpOpportunity {
  pending: boolean;
  firstObservedAt: number;
  latestObservedAt: number;
}

export interface TurnOutcomeSelection {
  nextOutcome: ChannelTurnOutcome;
  blockedReason?: string;
}

export interface ChannelAgentTurnSettingsSnapshot {
  modelId: string;
  streaming: boolean;
  maxSteps: number;
  baseTimeoutMs: number;
  perStepTimeoutMs: number;
  chunkTimeoutMs: number;
  contextWindow: number;
  compactionSettings: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    model?: string;
  };
}

export type ResponseState = "idle" | "responding" | "finalizing" | "aborting" | "ended";
