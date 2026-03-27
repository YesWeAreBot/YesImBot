import type { IngressMessage } from "./types";

export interface GroupFormatParams {
  username: string;
  content: string;
  timestamp: number;
  messageId: string;
  quotedContent?: string;
}

export interface DirectFormatParams {
  content: string;
  messageId: string;
}

export function formatTimeOnly(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatGroupMessage(params: GroupFormatParams): string {
  const time = formatTimeOnly(params.timestamp);
  const replyPrefix = params.quotedContent
    ? `[reply to: "${params.quotedContent.slice(0, 60)}"]\n`
    : "";
  return `${time} ${params.username}: ${replyPrefix}${params.content}`;
}

export function formatDirectMessage(params: DirectFormatParams): string {
  return params.content;
}

export function formatChannelPreamble(date: Date, participants: string[]): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  const participantList = participants.length > 0 ? participants.join("、") : "其他成员";
  return `<现在是${dateStr}，你正在和${participantList}讨论>`;
}

export function buildAgentMessage(formattedText: string, timestamp = Date.now()): IngressMessage {
  return {
    role: "user",
    content: [{ type: "text", text: formattedText }],
    timestamp,
  };
}
