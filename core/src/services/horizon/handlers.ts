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
  SummaryData,
  SummaryRecord,
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
  buildUserContent?: (text: string) => string | UserContent;
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
    const { shortIdAssigner, getShortId, channelKey, buildUserContent } = options;
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

    // Build message text
    const msgText = `<msg id="${shortId}" time="${timeStr}">${data.senderName}(${data.senderId}) ${replyLine}${data.content}</msg>`;

    // Use buildUserContent to embed images if available
    const content = buildUserContent ? buildUserContent(msgText) : msgText;

    return [{ role: "user", content }];
  }
}

class AgentResponseHandler extends TimelineHandler<AgentResponseRecord> {
  canHandle(entry: TimelineEntry): entry is AgentResponseRecord {
    return entry.type === TimelineEventType.AgentResponse;
  }

  handle(entry: AgentResponseRecord, _options: BuildContextOptions): LoopMessage[] {
    const { data } = entry;

    // Successful responses emit assistant message with rawText
    if (!data.error) {
      if (data.rawText) {
        return [{ role: "assistant", content: data.rawText }];
      }
      return [];
    }

    // Errors emit user message with error tag
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
        const ok = result.status === "ok" || result.status === "fulfilled" || !result.error;
        const preview = ok ? "sent" : "failed";
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

class SummaryHandler extends TimelineHandler<SummaryRecord> {
  canHandle(entry: TimelineEntry): entry is SummaryRecord {
    return entry.type === TimelineEventType.Summary;
  }

  handle(entry: SummaryRecord, _options: BuildContextOptions): LoopMessage[] {
    // Summary renders separately in formatHorizonText, not in history
    return [];
  }
}

export { MessageHandler, AgentResponseHandler, AgentActionHandler, SummaryHandler };
export type { TimelineHandler };
