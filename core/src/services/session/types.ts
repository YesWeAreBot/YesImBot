import type { Bot } from "koishi";

export interface ReplyReference {
  messageId?: string;
  userId?: string;
  username: string;
  nickname: string;
  summary: string;
}

export interface ChannelEvent {
  platform: string;
  channelId: string;
  userId: string;
  username: string;
  nickname?: string;
  identity?: string;
  replyTo?: ReplyReference;
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
    | "llm_judge"
    | "keyword_match"
    | "reply_without_at"
    | "no_trigger"
    | "self_message"
    | "duplicate";
}

export type ResponseEndReason =
  | "normal"
  | "heartbeat_continuation"
  | "protocol_error"
  | "timeout"
  | "abort"
  | "exception";

export interface ResponseEndRecord {
  endReason: ResponseEndReason;
  durationMs: number;
  stepsCompleted: number;
  error?: string;
}
