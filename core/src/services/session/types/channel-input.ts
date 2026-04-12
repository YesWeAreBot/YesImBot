import type { JSONValue } from "ai";

export type ChannelRawPayload = JSONValue;

export interface ReplyReference {
  messageId?: string;
  userId?: string;
  username: string;
  nickname: string;
  summary: string;
}

export interface SenderMetadata {
  userId: string;
  username: string;
  nickname?: string;
  identity?: string;
}

export interface ChannelMessageInput<TRaw extends ChannelRawPayload | undefined = undefined> {
  kind: "channel_message";
  platform: string;
  channelId: string;
  messageId: string;
  timestamp: number;
  content: string;
  sender: SenderMetadata;
  isDirect: boolean;
  atSelf: boolean;
  isReplyToBot: boolean;
  replyTo?: ReplyReference;
  raw?: TRaw;
}

export interface ChannelEventInput<TRaw extends ChannelRawPayload | undefined = undefined> {
  kind: "channel_event";
  platform: string;
  channelId: string;
  eventId: string;
  eventType: string;
  timestamp: number;
  sourceUserId?: string;
  raw?: TRaw;
}

export type ChannelInput<TRaw extends ChannelRawPayload | undefined = undefined> =
  | ChannelMessageInput<TRaw>
  | ChannelEventInput<TRaw>;
