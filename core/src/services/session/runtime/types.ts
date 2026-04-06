import { ToolLoopAgent, ToolSet } from "ai";
import type { Bot, Context, Logger } from "koishi";

import type { SessionManager } from "../session-manager";
import { SettingsReloadMetadata } from "../settings-manager";
import type { ChannelTurnOutcome } from "../types";
import type { WillingnessJudge } from "../willingness";

export interface ChannelRuntimeSettingsManager {
  reload(): SettingsReloadMetadata;
  getReloadMetadata(): SettingsReloadMetadata;
  getModel(): string | undefined;
  getJudgeSettings():
    | {
        model?: string;
        enabled?: boolean;
        timeoutMs?: number;
      }
    | undefined;
  getCompactionSettings():
    | {
        model?: string;
        enabled?: boolean;
        reserveTokens?: number;
        keepRecentTokens?: number;
        contextWindow?: number;
      }
    | undefined;
  getResponseSettings():
    | {
        streaming?: boolean;
        maxSteps?: number;
        baseTimeoutMs?: number;
        perStepTimeoutMs?: number;
        chunkTimeoutMs?: number;
      }
    | undefined;
  getWorkspaceSettings():
    | {
        enableWorkspace?: boolean;
        enableSandbox?: boolean;
        enableFilesystem?: boolean;
        externalPath?: string[];
        skills?: string[];
      }
    | undefined;
  getBuiltInInstructions(fallback?: string): string | undefined;
  getPromptResourceFilenames(fallback?: string[]): string[] | undefined;
}

export interface ChannelRuntimeOptions {
  bot?: Bot;
  sessionManager: SessionManager;
  settingsManager: ChannelRuntimeSettingsManager;
  willingnessJudge?: WillingnessJudge;
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
  messageCount: number;
  messageIds: string[];
}

export interface TurnOutcomeSelection {
  nextOutcome: ChannelTurnOutcome;
  blockedReason?: string;
}

export interface ChannelRuntimeTurnSettingsSnapshot {
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

export type ResponseState = "idle" | "responding";

export interface RuntimeTurnExecutionOptions {
  ctx: Context;
  logger: Logger;
  bot: Bot;
  sessionManager: SessionManager;
  settingsManager: ChannelRuntimeSettingsManager;
  platform: string;
  channelId: string;
  basePath: string;
  turnSettings: ChannelRuntimeTurnSettingsSnapshot;
  protocolRetry: boolean;
  abortSignal: AbortSignal;
}

export interface RuntimeTurnExecutionResult {
  responseActiveTools: string[];
}
