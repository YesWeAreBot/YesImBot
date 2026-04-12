import type { JSONValue } from "ai";

export type ChannelKey = `${string}:${string}`;

export type NextAction = "idle" | "follow_up" | "blocked";

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

export type ResponseStatusReason =
  | "normal"
  | "heartbeat_continuation"
  | "protocol_error"
  | "timeout"
  | "abort"
  | "exception";

export type ResponseStatusNoticeSubType =
  | "response_status_normal"
  | "response_status_heartbeat_continuation"
  | "response_status_protocol_error"
  | "response_status_timeout"
  | "response_status_abort"
  | "response_status_exception";

export type ResponseStatusRecord = Record<string, JSONValue | undefined> & {
  endReason: ResponseStatusReason;
  nextAction: NextAction;
  durationMs: number;
  stepsCompleted: number;
  error?: string;
  blockedReason?: string;
};

export interface FollowUpReviewRecord {
  content: string;
  firstObservedAt: number;
  latestObservedAt: number;
  messageCount: number;
  messageIds: string[];
}
