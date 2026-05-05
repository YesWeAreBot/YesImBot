import { AgentSession, CustomMessage } from "@yesimbot/agent";

type M<T> = Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">;

interface ChatMessageDetails {
  messageId: string;
  platform: string;
  channelId: string;
  senderId: string;
  senderName?: string;
  quoteMessageId?: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface ChatMessage extends M<ChatMessageDetails> {
  customType: "chat_message";
  details: ChatMessageDetails;
}

interface GroupNoticeDetails {
  noticeType: string;
  groupId: string;
  operatorId: string;
  operatorName?: string;
  timestamp: number;
  [key: string]: unknown;
}

interface GroupNotice extends M<GroupNoticeDetails> {
  customType: "group_notice";
  content: string;
  details: GroupNoticeDetails;
  [key: string]: unknown;
}

interface CustomMessages {
  chat_message: ChatMessage;
  group_notice: GroupNotice;
}

export type AthenaMessage = CustomMessages[keyof CustomMessages];

export function sendAthenaMessage(
  session: AgentSession,
  message: AthenaMessage,
  options?: {
    triggerTurn?: boolean;
    deliverAs?: "steer" | "followUp" | "nextTurn";
  },
) {
  return session.sendCustomMessage(message as M<unknown>, options);
}
