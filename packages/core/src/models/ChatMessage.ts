import { h, Session } from "koishi";

// import {} from "koishi-plugin-adapter-onebot";

export interface ChatMessage {
    sender: {
        id: string;   // 发送者平台 ID
        name: string; // 发送者原始昵称
        nick: string; // 发送者会话昵称
    }

    messageId: string;   // 消息 ID

    channelId: string;   // 消息来源 ID
    channelType: "private" | "guild" | "sandbox"; // 消息来源类型

    sendTime: Date;      // 发送时间
    content: string;     // 消息内容
    raw?: string;        // 原始消息，可能是LLM输出或者客户端上报数据
}

/**
 * 从 Session 中创建 ChatMessage
 * @param session
 * @param content
 * @returns
 */
export async function createMessage(session: Session, content?: string): Promise<ChatMessage> {
  const channelType = getChannelType(session.channelId);
  let senderNick = session.author.name;

  if (channelType === "guild") {
      // @ts-ignore
      if (session.onebot) {
          // @ts-ignore
          const memberInfo = await session.onebot.getGroupMemberInfo(session.channelId, session.userId);
          senderNick = memberInfo.card || memberInfo.nickname;
      }
  }

  // 提取被引用消息的 messageId
  const quotedMessageId = session.event.message?.quote?.id || null;

  const chatMessage = {
    sender: {
      id: session.userId,
      name: session.author.name,
      nick: senderNick
    },
    messageId: session.messageId,
    channelId: session.channelId,
    channelType: getChannelType(session.channelId),
    sendTime: new Date(), // 采用接收到消息时的本地时间
    content: (quotedMessageId ? h.quote(quotedMessageId).toString() : "") + (session.content || content),
  };
  return chatMessage;
}

/**
 * 根据 channelId 判断 channelType
 * @param channelId
 * @returns
 */
export function getChannelType(channelId: string): "private" | "guild" | "sandbox" {
    if (channelId.startsWith("private:")) {
        return "private";
    } else if (channelId === "#") {
        return "sandbox";
    } else {
        return "guild";
    }
}
