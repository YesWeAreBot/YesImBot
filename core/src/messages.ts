import type { UserContent } from "@yesimbot/agent/ai";

export interface BaseDetails {
  kind: "chat_message" | "group_notice" | string;
  platform: string;
  channelId: string;
  timestamp: number;
}

export interface BaseMessage<T extends BaseDetails> {
  customType: "athena:message";
  content: UserContent;
  display: boolean;
  details: T;
}

interface ChatMessageDetails extends BaseDetails {
  kind: "chat_message";
  messageId: string;
  senderId: string;
  senderName?: string;
  quoteMessageId?: string;
}

export type ChatMessage = BaseMessage<ChatMessageDetails>;

interface GroupNoticeDetails extends BaseDetails {
  kind: "group_notice";
  noticeType: string;
  groupId: string;
  operatorId: string;
  operatorName?: string;
}

export type GroupNotice = BaseMessage<GroupNoticeDetails>;

export interface CustomMessages {
  chat_message: ChatMessage;
  group_notice: GroupNotice;
}

export type AthenaMessage = CustomMessages[keyof CustomMessages];
