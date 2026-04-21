import type { Bot, Context, Logger } from "koishi";

import type { InstructionContributor } from "../instruction-contributor";
import type { InstructionStateService } from "../instruction-state/service";
import { WillingnessJudge } from "../messages/activation";
import type { NextAction } from "../messages/runtime-types";
import type { SessionManager } from "../session-manager";
import { SettingsReloadMetadata } from "../settings-manager";

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
  getBuiltInInstructions(fallback?: string): string | undefined;
}

export interface ChannelRuntimeOptions {
  bot?: Bot;
  sessionManager: SessionManager;
  settingsManager: ChannelRuntimeSettingsManager;
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
