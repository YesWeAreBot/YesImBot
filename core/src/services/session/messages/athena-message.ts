export interface ReplyReference {
  messageId?: string;
  userId?: string;
  username: string;
  nickname: string;
  summary: string;
}

export interface BaseAthenaMessage<K extends string, D> {
  type: K;
  timestamp: string;
  data: D;
}

export interface AthenaReplyReference {
  messageId?: string;
  senderName?: string;
  content?: string;
}

export type AthenaUserMessage = BaseAthenaMessage<
  "user.message",
  {
    messageId: string;
    senderId: string;
    senderName?: string;
    content: string;
    replyTo?: AthenaReplyReference;
  }
>;

export type AthenaMemberJoinMessage = BaseAthenaMessage<
  "notice.member.join",
  {
    content: string;
  }
>;

export type AthenaMemberLeaveMessage = BaseAthenaMessage<
  "notice.member.leave",
  {
    content: string;
  }
>;

export type AthenaReactionMessage = BaseAthenaMessage<
  "notice.reaction",
  {
    content: string;
  }
>;

export type AthenaStateUpdateMessage = BaseAthenaMessage<
  "notice.state.update",
  {
    content: string;
  }
>;

export type AthenaMessage =
  | AthenaUserMessage
  | AthenaMemberJoinMessage
  | AthenaMemberLeaveMessage
  | AthenaReactionMessage
  | AthenaStateUpdateMessage;

export function toAthenaReplyReference(replyTo: ReplyReference): AthenaReplyReference {
  return {
    messageId: replyTo.messageId,
    senderName: replyTo.username || replyTo.nickname,
    content: replyTo.summary,
  };
}
