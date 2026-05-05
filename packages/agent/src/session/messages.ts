import type { ImagePart, TextPart, UserContent } from "@ai-sdk/provider-utils";

import { AgentMessage, Message } from "../agent/types";

// #region ATHENA

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

/**
 * Message type for extension-injected messages via sendMessage().
 * These are custom messages that extensions can inject into the conversation.
 */
export interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: UserContent;
  display: boolean;
  details?: T;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

declare module "../agent/types" {
  interface CustomAgentMessages {
    custom: CustomMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string,
): CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary: summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime(),
  };
}

/** Convert CustomMessageEntry to AgentMessage format */
export function createCustomMessage(
  customType: string,
  content: UserContent,
  display: boolean,
  details: unknown | undefined,
  timestamp: string,
): CustomMessage {
  return {
    role: "custom",
    customType,
    content,
    display,
    details,
    timestamp: new Date(timestamp).getTime(),
  };
}

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 *
 * This is used by:
 * - Agent's transormToLlm option (for prompt calls and queued messages)
 * - Compaction's generateSummary (for summarization)
 * - Custom extensions and tools
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .map((m): Message | undefined => {
      switch (m.role) {
        case "custom": {
          const content =
            typeof m.content === "string"
              ? [{ type: "text" as const, text: m.content }]
              : m.content;
          return {
            role: "user",
            content,
          };
        }

        case "compactionSummary":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX,
              },
            ],
          };
        case "user":
          return {
            role: "user",
            content: m.content,
            ...(m.providerOptions !== undefined && { providerOptions: m.providerOptions }),
          };
        case "assistant":
          return {
            role: "assistant",
            content: m.content,
            ...(m.providerOptions !== undefined && { providerOptions: m.providerOptions }),
          };
        case "tool": {
          return {
            role: "tool",
            content: m.content,
            ...(m.providerOptions !== undefined && { providerOptions: m.providerOptions }),
          };
        }
        default:
          const _exhaustiveCheck: never = m;
          return undefined;
      }
    })
    .filter((m) => m !== undefined);
}
