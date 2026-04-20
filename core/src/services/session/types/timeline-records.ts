import type { AssistantModelMessage, ToolModelMessage } from "@ai-sdk/provider-utils";

import type { ChannelEventInput, ChannelMessageInput, ChannelRawPayload } from "./channel-input";
import type { AthenaEvent } from "../domain/athena-event";
import type { ActivationReason } from "../domain/activation";

export const TIMELINE_RECORD_KINDS = [
  "athena_event",
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

export interface TimelineRecordBase {
  id: string;
  kind: TimelineRecordKind;
  timestamp: number;
  stage: TimelineRecordStage;
  visibility: TimelineRecordVisibility;
  materialization: TimelineRecordMaterialization;
}

export interface ChannelMessageRecord<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends TimelineRecordBase {
  kind: "channel_message";
  message: ChannelMessageInput<TRaw>;
}

export interface ChannelEventRecord<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends TimelineRecordBase {
  kind: "channel_event";
  event: ChannelEventInput<TRaw>;
}

export interface AthenaEventRecord<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends TimelineRecordBase {
  kind: "athena_event";
  event: AthenaEvent<TRaw>;
}

export interface AssistantMessageRecord extends TimelineRecordBase {
  kind: "assistant_message";
  message: AssistantModelMessage;
}

export interface ToolMessageRecord extends TimelineRecordBase {
  kind: "tool_message";
  message: ToolModelMessage;
}

export interface StateChangeRecord<
  TData extends ChannelRawPayload | undefined = undefined,
> extends TimelineRecordBase {
  kind: "state_change";
  stateType: string;
  data?: TData;
}

export interface SystemNoticeRecord<
  TData extends ChannelRawPayload | undefined = undefined,
> extends TimelineRecordBase {
  kind: "system_notice";
  subType: string;
  materializationKey: string;
  notice: string;
  data?: TData;
}

export type ActivationResultRecordData = {
  batchId: string;
  activated: boolean;
  reasons: ActivationReason[];
};

export type TimelineRecordWithRaw<TRaw extends ChannelRawPayload | undefined = undefined> =
  | AthenaEventRecord<TRaw>
  | ChannelMessageRecord<TRaw>
  | ChannelEventRecord<TRaw>
  | AssistantMessageRecord
  | ToolMessageRecord
  | StateChangeRecord<ChannelRawPayload | undefined>
  | SystemNoticeRecord<ChannelRawPayload | undefined>;

export type TimelineRecord = TimelineRecordWithRaw<ChannelRawPayload | undefined>;
