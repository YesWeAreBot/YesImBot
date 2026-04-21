import { ReplyReference } from "./athena-message";

export interface AthenaEventBase {
  id: string;
  timestamp: number;
}

interface SenderMetadata {
  userId: string;
  username: string;
  nickname?: string;
  identity?: string;
}

interface KoishiMessagePayload {}

export interface AthenaMessageEvent extends AthenaEventBase {
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
  raw?: KoishiMessagePayload;
}

interface KoishiChannelEventPayload {}

export interface AthenaChannelEvent extends AthenaEventBase {
  kind: "channel_event";
  platform: string;
  channelId: string;
  eventId: string;
  eventType: string;
  sourceUserId?: string;
  raw?: KoishiChannelEventPayload;
}

interface KoishiPlatformNoticePayload {}

export interface AthenaPlatformNoticeEvent extends AthenaEventBase {
  kind: "platform_notice";
  platform: string;
  channelId: string;
  noticeType: string;
  summary: string;
  raw?: KoishiPlatformNoticePayload;
}

interface InternalSignalRawPayload {}

export interface AthenaInternalSignalEvent extends AthenaEventBase {
  kind: "internal_signal";
  platform: string;
  channelId: string;
  signalType: string;
  source: string;
  summary?: string;
  raw?: InternalSignalRawPayload;
}

export type AthenaEvent =
  | AthenaMessageEvent
  | AthenaChannelEvent
  | AthenaPlatformNoticeEvent
  | AthenaInternalSignalEvent;
