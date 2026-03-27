import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Bot } from "koishi";

/** Channel context captured at session creation time for tool closures (per D-20). */
export interface ChannelContext {
  /** Function to send a message to the current channel. */
  sendFn: (content: string) => Promise<void>;
  bot?: Bot;
  platform: string;
  channelId: string;
  selfId: string;
  sessionDir: string;
}

/**
 * Extended tool metadata for Athena-specific behavior.
 * `terminal` marks tools that end the turn after execution (per D-21).
 */
export interface AthenaToolMeta {
  terminal: boolean;
}

/** A ToolDefinition paired with Athena metadata. */
export interface AthenaToolDefinition {
  definition: ToolDefinition;
  meta: AthenaToolMeta;
}
