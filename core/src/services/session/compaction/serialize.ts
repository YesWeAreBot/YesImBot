// ============================================================================
// Serialization Helpers
// ============================================================================

import type { ModelMessage, TextPart } from "@ai-sdk/provider-utils";

import { convertToLlm } from "../materialize";
import type { SessionMessage } from "../messages";
import { AgentAssistantContentPart, AgentMessage, ContentPart } from "../session-manager";

const TOOL_RESULT_MAX_CHARS = 2000;

function shouldExcludeCustomMessageFromSummary(customType: string): boolean {
  return (
    customType === "protocol_guidance" ||
    customType.startsWith("protocol_") ||
    customType.startsWith("control_")
  );
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

function contentPartsToText(parts: ContentPart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function assistantContentToText(parts: AgentAssistantContentPart[]): {
  thinking: string[];
  texts: string[];
  toolCalls: string[];
} {
  const thinking: string[] = [];
  const texts: string[] = [];
  const toolCalls: string[] = [];

  for (const part of parts) {
    switch (part.type) {
      case "text":
        texts.push(part.text);
        break;
      case "thinking":
        thinking.push(part.text);
        break;
      case "tool-call": {
        const argsStr = Object.entries(part.args as Record<string, unknown>)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        toolCalls.push(`${part.toolName}(${argsStr})`);
        break;
      }
    }
  }

  return { thinking, texts, toolCalls };
}

// ============================================================================
// Conversation Serialization
// ============================================================================

/**
 * Serialize a list of AgentMessages into a labeled text block suitable for
 * sending to a summarization LLM.
 *
 * The format uses labeled prefixes so the summarizer can identify who said
 * what without being able to continue the conversation.
 *
 * Labels:
 *   [User]: <content>
 *   [Assistant]: <text content>
 *   [Assistant thinking]: <thinking>
 *   [Assistant tool calls]: toolName(args); toolName(args)
 *   [Tool result]: <result, truncated to 2000 chars>
 *   [Channel message] <username>: <content>
 */
export function serializeConversation(messages: AgentMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const text =
          typeof msg.content === "string" ? msg.content : contentPartsToText(msg.content);
        if (text) parts.push(`[User]: ${text}`);
        break;
      }

      case "assistant": {
        if (typeof msg.content === "string") {
          if (msg.content) parts.push(`[Assistant]: ${msg.content}`);
        } else {
          const { thinking, texts, toolCalls } = assistantContentToText(msg.content);
          if (thinking.length > 0) parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
          if (texts.length > 0) parts.push(`[Assistant]: ${texts.join("\n")}`);
          if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
        }
        break;
      }

      case "tool": {
        for (const part of msg.content) {
          const raw = typeof part.result === "string" ? part.result : JSON.stringify(part.result);
          parts.push(`[Tool result]: ${truncateForSummary(raw, TOOL_RESULT_MAX_CHARS)}`);
        }
        break;
      }

      case "custom": {
        if (shouldExcludeCustomMessageFromSummary(msg.customType)) {
          break;
        }

        // channel_message custom entries: format as [Channel message] username: content
        if (msg.customType === "channel_message") {
          const text =
            typeof msg.content === "string" ? msg.content : contentPartsToText(msg.content);
          if (text) {
            // content is already formatted as "[username]: message" by the channel pipeline
            parts.push(`[Channel message] ${text}`);
          }
        } else {
          const text =
            typeof msg.content === "string" ? msg.content : contentPartsToText(msg.content);
          if (text) parts.push(`[${msg.customType}]: ${text}`);
        }
        break;
      }
    }
  }

  return parts.join("\n\n");
}

export function serializeSessionMessagesForCompaction(messages: readonly SessionMessage[]): string {
  return serializeModelMessages(convertToLlm([...messages]));
}

function serializeModelMessages(messages: readonly ModelMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        parts.push(`[System]: ${stringifyModelMessageContent(message.content)}`);
        break;
      case "user":
        parts.push(`[User]: ${stringifyModelMessageContent(message.content)}`);
        break;
      case "assistant":
        parts.push(`[Assistant]: ${stringifyModelMessageContent(message.content)}`);
        break;
      case "tool":
        parts.push(`[Tool]: ${stringifyModelMessageContent(message.content)}`);
        break;
    }
  }

  return parts.join("\n\n");
}

function stringifyModelMessageContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part.type === "text") {
        return part.text;
      }

      return JSON.stringify(part);
    })
    .join("\n");
}
