import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Bot } from "koishi";

export interface SessionServiceConfig {
  athenaDir: string;
  triggerKeywords: string[];
  cooldownMs: number;
  maxMessageLength: number;
  debugLevel?: number;
}

/** Per D-10: lightweight interface carrying raw platform data. */
export interface ChannelEvent {
  platform: string;
  channelId: string;
  userId: string;
  username: string;
  content: string;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  messageId: string;
  timestamp: number;
  elements: unknown[];
  bot?: Bot;
}

export type ChannelKey = string;

export interface SessionStatus {
  channelKey: ChannelKey;
  platform: string;
  channelId: string;
  isStreaming: boolean;
  hasBot: boolean;
  sessionDir: string;
}

export interface SessionEntry {
  key: ChannelKey;
  session: AgentSession;
  sessionDir: string;
  unsubscribe: () => void;
  bot?: Bot;
  channelId: string;
  platform: string;
  modelRef: string;
}

export type IngressMessage = Extract<AgentMessage, { role: "user" }>;
export type IngressMessageContent = IngressMessage["content"];

export interface WillingnessResult {
  shouldRespond: boolean;
  reason: "direct_message" | "at_self" | "keyword_match" | "reply_without_at" | "no_trigger";
}
