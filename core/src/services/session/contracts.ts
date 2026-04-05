import type { AssistantModelMessage, ToolModelMessage } from "@ai-sdk/provider-utils";
import type { JSONValue } from "ai";

export const TIMELINE_RECORD_KINDS = [
  "channel_message",
  "channel_event",
  "assistant_message",
  "tool_message",
  "state_change",
  "system_notice",
] as const;

export type TimelineRecordKind = (typeof TIMELINE_RECORD_KINDS)[number];

export type TimelineRecordStage = "ingress" | "runtime" | "persisted";

export type TimelineRecordVisibility = "model" | "internal" | "hidden";

export type TimelineRecordMaterialization = "default" | "internal" | "hidden" | "subtype";

export type CanonicalRawPayload = JSONValue;

export interface CanonicalReplyReference {
  messageId?: string;
  userId?: string;
  username: string;
  nickname: string;
  summary: string;
}

export interface CanonicalSenderMetadata {
  userId: string;
  username: string;
  nickname?: string;
  identity?: string;
}

export interface CanonicalChannelMessageInput<TRaw extends CanonicalRawPayload | undefined = undefined> {
  kind: "channel_message";
  platform: string;
  channelId: string;
  messageId: string;
  timestamp: number;
  content: string;
  sender: CanonicalSenderMetadata;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  replyTo?: CanonicalReplyReference;
  raw?: TRaw;
}

export interface CanonicalChannelEventInput<TRaw extends CanonicalRawPayload | undefined = undefined> {
  kind: "channel_event";
  platform: string;
  channelId: string;
  eventId: string;
  eventType: string;
  timestamp: number;
  sourceUserId?: string;
  raw?: TRaw;
}

export type CanonicalChannelInput<TRaw extends CanonicalRawPayload | undefined = undefined> =
  | CanonicalChannelMessageInput<TRaw>
  | CanonicalChannelEventInput<TRaw>;

export interface TimelineRecordBase {
  id: string;
  kind: TimelineRecordKind;
  timestamp: number;
  stage: TimelineRecordStage;
  visibility: TimelineRecordVisibility;
  materialization: TimelineRecordMaterialization;
}

export interface ChannelMessageRecord<TRaw extends CanonicalRawPayload | undefined = undefined>
  extends TimelineRecordBase {
  kind: "channel_message";
  message: CanonicalChannelMessageInput<TRaw>;
}

export interface ChannelEventRecord<TRaw extends CanonicalRawPayload | undefined = undefined>
  extends TimelineRecordBase {
  kind: "channel_event";
  event: CanonicalChannelEventInput<TRaw>;
}

export interface AssistantMessageRecord extends TimelineRecordBase {
  kind: "assistant_message";
  message: AssistantModelMessage;
}

export interface ToolMessageRecord extends TimelineRecordBase {
  kind: "tool_message";
  message: ToolModelMessage;
}

export interface StateChangeRecord<TData extends CanonicalRawPayload | undefined = undefined>
  extends TimelineRecordBase {
  kind: "state_change";
  stateType: string;
  data?: TData;
}

export interface SystemNoticeRecord<TData extends CanonicalRawPayload | undefined = undefined>
  extends TimelineRecordBase {
  kind: "system_notice";
  subType: string;
  materializationKey: string;
  notice: string;
  data?: TData;
}

export type TimelineRecordWithRaw<TRaw extends CanonicalRawPayload | undefined = undefined> =
  | ChannelMessageRecord<TRaw>
  | ChannelEventRecord<TRaw>
  | AssistantMessageRecord
  | ToolMessageRecord
  | StateChangeRecord<CanonicalRawPayload | undefined>
  | SystemNoticeRecord<CanonicalRawPayload | undefined>;

export type TimelineRecord = TimelineRecordWithRaw;
