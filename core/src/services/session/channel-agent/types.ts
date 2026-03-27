import type { ToolSet } from "ai";
import type { Bot } from "koishi";

import { SessionManager } from "../session-manager";

export interface ChannelAgentOptions {
  bot: Bot;
  sessionManager: SessionManager;
  platform: string;
  channelId: string;
  modelId: string;
  basePath: string;
  instructions: string | (() => string | Promise<string>);
  tools?: ToolSet;
  maxSteps?: number;
  aggregationWindowMs?: number;
  /** Total response timeout in ms. Default 60000. Per D-01. */
  responseTimeoutMs?: number;
  /** Chunk timeout in ms for model streaming. Per D-01. */
  chunkTimeoutMs?: number;
  /** Fraction of context window to trigger compaction (0-1). */
  compactionThreshold?: number;
}

export type ResponseState = "idle" | "responding" | "aborting" | "ended";
