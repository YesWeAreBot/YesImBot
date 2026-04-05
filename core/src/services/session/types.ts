import type { Bot } from "koishi";

export type {
  AssistantMessageRecord,
  CanonicalChannelEventInput,
  CanonicalChannelInput,
  CanonicalChannelMessageInput,
  ChannelEventRecord,
  ChannelMessageRecord,
  StateChangeRecord,
  SystemNoticeRecord,
  TimelineRecord,
  TimelineRecordMaterialization,
  TimelineRecordStage,
  TimelineRecordVisibility,
  ToolMessageRecord,
} from "./contracts";

import type { CanonicalReplyReference } from "./contracts";

export type ReplyReference = CanonicalReplyReference;

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

export type ChannelTurnOutcome = "idle" | "follow_up" | "blocked";

export type ChannelBootstrapStatus =
  | "ready"
  | "restored"
  | "created"
  | "missing_workspace"
  | "failed";

export interface ChannelBootstrapResult {
  channelKey: ChannelKey;
  status: ChannelBootstrapStatus;
  error?: string;
}

export interface WillingnessResult {
  shouldRespond: boolean;
  reason:
    | "direct_message"
    | "at_self"
    | "llm_judge"
    | "reply_without_at"
    | "no_trigger"
    | "self_message";
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
  nextOutcome: ChannelTurnOutcome;
  durationMs: number;
  stepsCompleted: number;
  error?: string;
  blockedReason?: string;
}

export interface FollowUpReviewRecord {
  content: string;
  firstObservedAt: number;
  latestObservedAt: number;
  messageCount: number;
  messageIds: string[];
}
