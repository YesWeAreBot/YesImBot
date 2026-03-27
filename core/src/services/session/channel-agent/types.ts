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
  /** Maximum tool-call steps per response. Default 20. Per D-07. */
  maxSteps?: number;
  aggregationWindowMs?: number;
  /** Base response timeout in ms for cumulative timeout. Default 60000. Per D-05. */
  baseTimeoutMs?: number;
  /** Additional timeout in ms per allowed step. Default 30000. Per D-05. */
  perStepTimeoutMs?: number;
  /**
   * @deprecated Use baseTimeoutMs/perStepTimeoutMs cumulative timeout model.
   * Retained temporarily for compatibility with existing configs.
   */
  responseTimeoutMs?: number;
  /** Chunk timeout in ms for model streaming. Per D-01. */
  chunkTimeoutMs?: number;
  /** Fraction of context window to trigger compaction (0-1). */
  compactionThreshold?: number;
  sendMessageDirectly?: boolean;
  enableWorkspace?: boolean;
  enableSandbox?: boolean;
  enableFilesystem?: boolean;
  externalPath?: string | string[];
}

export type ResponseState = "idle" | "responding" | "aborting" | "ended";
