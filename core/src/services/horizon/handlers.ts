import type { ImagePart, TextPart, UserContent } from "ai";

import type { LoopMessage } from "../agent/trimmer";
import type {
  AgentActionData,
  AgentActionRecord,
  AgentResponseData,
  AgentResponseRecord,
  ImageConfig,
  MessageEventData,
  MessageRecord,
  TimelineEntry,
} from "./types";
import { TimelineEventType } from "./types";

export interface BuildContextOptions {
  selfId?: string;
  channelKey?: string;
  imageConfig?: ImageConfig;
  shortIdAssigner?: (channelKey: string, msgId: string) => number;
  getShortId?: (channelKey: string, msgId: string) => number | undefined;
  getImageCache?: (
    id: string,
  ) => { base64: string; mediaType: string; status: "ok" | "failed" } | undefined;
}

abstract class TimelineHandler<T extends TimelineEntry> {
  abstract canHandle(entry: TimelineEntry): entry is T;
  abstract handle(entry: T, options: BuildContextOptions): LoopMessage[];
}

class MessageHandler extends TimelineHandler<MessageRecord> {
  canHandle(entry: TimelineEntry): entry is MessageRecord {
    return entry.type === TimelineEventType.Message;
  }

  handle(entry: MessageRecord, options: BuildContextOptions): LoopMessage[] {
    const { shortIdAssigner, getShortId, channelKey } = options;
    const { data, timestamp } = entry;

    // Assign short ID
    const shortId = shortIdAssigner && channelKey ? shortIdAssigner(channelKey, data.messageId) : 0;

    // Format time as DD:HH:MM
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const timeStr = `${day}:${hour}:${minute}`;

    // Build reply line if replyTo exists
    let replyLine = "";
    if (data.replyTo && getShortId && channelKey) {
      const replyShortId = getShortId(channelKey, data.replyTo);
      if (replyShortId !== undefined) {
        replyLine = `[回复: ${replyShortId}] `;
      }
    }

    // Build content with image support
    let content: string | UserContent;
    if (typeof data.content === "string") {
      content = `<msg id="${shortId}" time="${timeStr}">${data.senderName}(${data.senderId}) ${replyLine}${data.content}</msg>`;
    } else {
      // UserContent array - wrap each part with appropriate formatting
      const parts: Array<TextPart | ImagePart> = [];
      parts.push({
        type: "text",
        text: `<msg id="${shortId}" time="${timeStr}">${data.senderName}(${data.senderId}) ${replyLine}`,
      });

      const contentParts = data.content as Array<TextPart | ImagePart>;
      let imgIndex = 0;
      for (const part of contentParts) {
        if (part.type === "text") {
          parts.push(part);
        } else if (part.type === "image") {
          imgIndex++;
          parts.push({ type: "text", text: `\n[图片 #${imgIndex}]` });
          parts.push(part);
        }
      }

      parts.push({ type: "text", text: "</msg>" });
      content = parts;
    }

    return [{ role: "user", content }];
  }
}

class AgentResponseHandler extends TimelineHandler<AgentResponseRecord> {
  canHandle(entry: TimelineEntry): entry is AgentResponseRecord {
    return entry.type === TimelineEventType.AgentResponse;
  }

  handle(entry: AgentResponseRecord, _options: BuildContextOptions): LoopMessage[] {
    const { data } = entry;

    // Only emit error observations; successful responses are silent
    if (!data.error) {
      return [];
    }

    // Escape XML special characters
    const escapedError = this.escapeXml(data.error);

    return [{ role: "user", content: `<error>${escapedError}</error>` }];
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}

class AgentActionHandler extends TimelineHandler<AgentActionRecord> {
  canHandle(entry: TimelineEntry): entry is AgentActionRecord {
    return entry.type === TimelineEventType.AgentAction;
  }

  handle(entry: AgentActionRecord, _options: BuildContextOptions): LoopMessage[] {
    const { data } = entry;
    const lines: string[] = [];

    // Format actions
    for (const action of data.actions) {
      const paramsStr = action.params ? JSON.stringify(action.params) : "";
      lines.push(`${action.name}(${paramsStr})`);
    }

    // Format tool results
    for (const result of data.toolResults) {
      if (result.name === "send_message") {
        const preview = result.status === "sent" ? "sent" : "failed";
        lines.push(`send_message -> ${preview}`);
      } else {
        const preview = result.result != null ? String(result.result).slice(0, 100) : "";
        const status = result.error ?? result.status;
        lines.push(`${result.name} -> ${status}${preview ? ": " + preview : ""}`);
      }
    }

    if (lines.length === 0) {
      return [];
    }

    const content = `<action>\n${lines.join("\n")}\n</action>`;
    return [{ role: "user", content }];
  }
}

export { MessageHandler, AgentResponseHandler, AgentActionHandler };
export type { TimelineHandler };
