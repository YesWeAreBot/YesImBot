import { toAthenaReplyReference } from "./athena-message";
import type {
  AthenaMemberJoinMessage,
  AthenaMemberLeaveMessage,
  AthenaMessage,
  AthenaReactionMessage,
  AthenaStateUpdateMessage,
  AthenaUserMessage,
} from "./athena-message";
import type { AthenaEvent } from "./athena-event";

export function projectToAthenaMessage(event: AthenaEvent): AthenaMessage {
  switch (event.kind) {
    case "message":
      return projectMessageEvent(event);
    case "channel_event":
      return projectChannelEvent(event);
    case "platform_notice":
      return projectPlatformNoticeEvent(event);
    case "internal_signal":
      return projectInternalSignalEvent(event);
    default: {
      const exhaustiveCheck: never = event;
      throw new Error(`Unsupported AthenaEvent kind: ${String(exhaustiveCheck)}`);
    }
  }
}

function projectMessageEvent(event: Extract<AthenaEvent, { kind: "message" }>): AthenaUserMessage {
  return {
    type: "user.message",
    timestamp: new Date(event.timestamp).toISOString(),
    data: {
      messageId: event.messageId,
      senderId: event.sender.userId,
      senderName: event.sender.nickname || event.sender.username,
      content: event.content,
      replyTo: event.replyTo ? toAthenaReplyReference(event.replyTo) : undefined,
    },
  };
}

function projectChannelEvent(
  event: Extract<AthenaEvent, { kind: "channel_event" }>,
): AthenaMemberJoinMessage | AthenaMemberLeaveMessage {
  if (event.eventType === "member_joined") {
    return {
      type: "notice.member.join",
      timestamp: new Date(event.timestamp).toISOString(),
      data: {
        content: `[channel-event] type=${event.eventType} platform=${event.platform} channel=${event.channelId} sourceUserId=${event.sourceUserId ?? "unknown"}`,
      },
    };
  }

  return {
    type: "notice.member.leave",
    timestamp: new Date(event.timestamp).toISOString(),
    data: {
      content: `[channel-event] type=${event.eventType} platform=${event.platform} channel=${event.channelId} sourceUserId=${event.sourceUserId ?? "unknown"}`,
    },
  };
}

function projectPlatformNoticeEvent(
  event: Extract<AthenaEvent, { kind: "platform_notice" }>,
): AthenaStateUpdateMessage {
  return {
    type: "notice.state.update",
    timestamp: new Date(event.timestamp).toISOString(),
    data: {
      content: `[platform-notice] type=${event.noticeType} platform=${event.platform} channel=${event.channelId ?? "unknown"} summary=${event.summary}`,
    },
  };
}

function projectInternalSignalEvent(
  event: Extract<AthenaEvent, { kind: "internal_signal" }>,
): AthenaReactionMessage {
  return {
    type: "notice.reaction",
    timestamp: new Date(event.timestamp).toISOString(),
    data: {
      content: `[internal-signal] type=${event.signalType} source=${event.source} summary=${event.summary ?? ""}`.trim(),
    },
  };
}
