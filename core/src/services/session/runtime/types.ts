import type { Bot, Context, Logger } from "koishi";

import { InstructionContributor } from "../instruction-state/contributor";
import type { InstructionStateService } from "../instruction-state/service";
import type { FollowUpReviewRecord } from "../messages";
import { WillingnessJudge } from "../messages/activation";
import type { NextAction } from "../messages/runtime-types";
import type { SessionManager } from "../session-manager";
import { SettingsReloadMetadata } from "../settings-manager";

export interface SessionRuntimeSettingsManager {
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
  getBuiltInInstructions(fallback?: string): string | undefined;
}

export interface SessionRuntimeOptions {
  bot?: Bot;
  sessionManager: SessionManager;
  settingsManager: SessionRuntimeSettingsManager;
  instructionStateService?: InstructionStateService;
  instructions?: InstructionContributor[];
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

export interface NextActionSelection {
  nextAction: NextAction;
  blockedReason?: string;
}

export interface ResponseWindowSettingsSnapshot {
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

export interface SessionRuntimeBusyWindowSnapshot {
  responseWindow: ResponseWindowSettingsSnapshot | null;
  instructions: string | null;
  activeFollowUpReview: FollowUpReviewRecord | null;
  queuedFollowUpReview: FollowUpReviewRecord | null;
  protocolRetry: boolean;
  startedAt: number;
  completedSteps: number;
  activeTools: string[];
}

export interface SessionRuntimeSnapshot {
  state: ResponseState;
  busyWindow: SessionRuntimeBusyWindowSnapshot;
  pendingFollowUp: MergedFollowUpOpportunity | null;
  responseContext: unknown;
  toolExperimentalContext: unknown;
}

export interface SessionRuntimeExecutionOptions {
  ctx: Context;
  logger: Logger;
  bot: Bot;
  sessionManager: SessionManager;
  settingsManager: SessionRuntimeSettingsManager;
  platform: string;
  channelId: string;
  basePath: string;
  responseWindow: ResponseWindowSettingsSnapshot;
  protocolRetry: boolean;
  abortSignal: AbortSignal;
}

export interface SessionRuntimeExecutionResult {
  responseActiveTools: string[];
}
