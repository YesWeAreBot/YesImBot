import type { Bot } from "koishi";

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

export type ChannelKey = `${string}:${string}`;

export interface WillingnessResult {
  shouldRespond: boolean;
  reason:
    | "direct_message"
    | "at_self"
    | "keyword_match"
    | "reply_without_at"
    | "no_trigger"
    | "self_message"
    | "duplicate";
}

export type ResponseEndReason = "normal" | "abort" | "timeout" | "error";

export interface ResponseEndRecord {
  endReason: ResponseEndReason;
  durationMs: number;
  stepsCompleted: number;
  error?: string;
}
