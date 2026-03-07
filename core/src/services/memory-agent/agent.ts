import type { Context } from "koishi";

import type { ChannelKey } from "../shared/types";
import type { MemoryAgentConfig } from "./types";

/**
 * Run memory extraction for a channel using ai-sdk agent loop.
 * Implemented fully in Task 2.
 */
export async function runMemoryExtraction(
  ctx: Context,
  channelKey: ChannelKey,
  platform: string,
  config: MemoryAgentConfig,
): Promise<void> {
  // Stub — full implementation in Task 2
  const logger = ctx.logger("memory-agent");
  logger.debug(`runMemoryExtraction stub called for ${platform}:${channelKey.channelId}`);
}
