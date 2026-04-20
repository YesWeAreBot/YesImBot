import type { ChannelMessageInput, ChannelRawPayload } from "./types/index";

export function summarizeReplyContent(content: string, maxChars = 80): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}…`;
}

export function resolveSenderIdentity(input: {
  isDirect: boolean;
  title?: string;
  roles?: string[];
  isBot?: boolean;
}): string {
  if (input.isDirect === true) {
    return "direct-user";
  }

  const title = input.title?.trim();
  if (title) {
    return `title:${title}`;
  }

  if (Array.isArray(input.roles) && input.roles.length > 0) {
    return `roles:${input.roles.join("|")}`;
  }

  if (input.isBot === true) {
    return "bot";
  }

  return "member";
}

export function formatChannelMessageInput(
  event: ChannelMessageInput<ChannelRawPayload | undefined>,
): string {
  const lines = [
    `[timestamp] ${new Date(event.timestamp).toISOString()}`,
    `[platform/channel] ${event.platform}/${event.channelId}`,
    `[sender] id=${event.sender.userId} username=${event.sender.username} nickname=${event.sender.nickname ?? event.sender.username} identity=${event.sender.identity ?? "member"}`,
    `[context] direct=${event.isDirect} mention=${event.atSelf} reply=${event.isReplyToBot}`,
  ];

  if (event.replyTo) {
    lines.push(
      `[reply] target=${event.replyTo.username} (${event.replyTo.nickname}) summary=${event.replyTo.summary}`,
    );
  }

  return `${lines.join("\n")}\n\n${event.content}`;
}
