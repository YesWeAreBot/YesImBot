import type { ChannelRawPayload, ReplyReference, SenderMetadata } from "./channel-input";

export interface AthenaEventBase {
  id: string;
  timestamp: number;
}

export interface AthenaMessageEvent<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends AthenaEventBase {
  kind: "message";
  platform: string;
  channelId: string;
  messageId: string;
  content: string;
  sender: SenderMetadata;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  replyTo?: ReplyReference;
  raw?: TRaw;
}

export interface AthenaChannelEvent<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends AthenaEventBase {
  kind: "channel_event";
  platform: string;
  channelId: string;
  eventId: string;
  eventType: string;
  sourceUserId?: string;
  raw?: TRaw;
}

export interface AthenaPlatformNoticeEvent<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends AthenaEventBase {
  kind: "platform_notice";
  platform: string;
  channelId?: string;
  noticeType: string;
  summary: string;
  raw?: TRaw;
}

export interface AthenaInternalSignalEvent<
  TRaw extends ChannelRawPayload | undefined = undefined,
> extends AthenaEventBase {
  kind: "internal_signal";
  platform: string;
  channelId: string;
  signalType: string;
  source: string;
  summary?: string;
  raw?: TRaw;
}

export type AthenaEvent<TRaw extends ChannelRawPayload | undefined = undefined> =
  | AthenaMessageEvent<TRaw>
  | AthenaChannelEvent<TRaw>
  | AthenaPlatformNoticeEvent<TRaw>
  | AthenaInternalSignalEvent<TRaw>;

export type ChannelScopedAthenaEvent<TRaw extends ChannelRawPayload | undefined = undefined> =
  Extract<AthenaEvent<TRaw>, { channelId: string }>;
