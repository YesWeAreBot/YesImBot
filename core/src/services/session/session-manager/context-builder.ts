import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from "@ai-sdk/provider-utils";

import type {
  AgentAssistantMessage,
  AgentMessage,
  AgentToolMessage,
  AgentUserMessage,
  CompactionEntry,
  ContentPart,
  CustomMessageEntry,
  SessionContext,
  SessionEntry,
} from "./types";

// ============================================================================
// AgentMessage → AI SDK ModelMessage conversion
// ============================================================================

function userToModelMessage(msg: AgentUserMessage): UserModelMessage {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }
  return {
    role: "user",
    content: msg.content.map((part) => {
      if (part.type === "text") return { type: "text" as const, text: part.text };
      return {
        type: "image" as const,
        image: part.image,
        mimeType: part.mimeType,
      };
    }),
  };
}

function assistantToModelMessage(msg: AgentAssistantMessage): AssistantModelMessage {
  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content };
  }
  const content = msg.content.map((part) => {
    switch (part.type) {
      case "text":
        return { type: "text" as const, text: part.text };
      case "tool-call":
        return {
          type: "tool-call" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.args,
        };
      case "thinking":
        return { type: "reasoning" as const, text: part.text };
    }
  });
  return { role: "assistant", content } as AssistantModelMessage;
}

function toolToModelMessage(msg: AgentToolMessage): ToolModelMessage {
  return {
    role: "tool",
    content: msg.content.map((part) => ({
      type: "tool-result" as const,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: { type: "json" as const, value: part.result as import("@ai-sdk/provider").JSONValue },
      isError: part.isError,
    })),
  };
}

/** Convert an AgentMessage to an AI SDK ModelMessage. */
function agentMessageToModelMessage(msg: Exclude<AgentMessage, { role: "custom" }>): ModelMessage {
  switch (msg.role) {
    case "user":
      return userToModelMessage(msg);
    case "assistant":
      return assistantToModelMessage(msg);
    case "tool":
      return toolToModelMessage(msg);
  }
}

// ============================================================================
// CustomMessageEntry → UserModelMessage
// ============================================================================

function contentPartsToString(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function customMessageToUserMessage(entry: CustomMessageEntry): UserModelMessage {
  const text = contentPartsToString(entry.content);
  return { role: "user", content: text };
}

// ============================================================================
// buildSessionContext
// ============================================================================

/**
 * Build the LLM context from session entries.
 *
 * Walks entries linearly, converting them to AI SDK ModelMessage[].
 * Handles compaction: when a CompactionEntry is found, all previously
 * accumulated messages are replaced by the compaction summary.
 *
 * Entry type handling:
 * - SessionMessageEntry → preserve as AgentMessage runtime state
 * - CustomMessageEntry  → preserve as AgentCustomMessage runtime state
 * - CompactionEntry     → reset context, insert summary AgentUserMessage
 * - ModelChangeEntry    → track model, skip from runtime messages
 * - CustomEntry         → skip (not in runtime/model context)
 */
export function buildSessionContext(entries: readonly SessionEntry[]): SessionContext {
  let agentMessages: AgentMessage[] = [];
  let model: { provider: string; modelId: string } | null = null;
  let compaction: CompactionEntry | null = null;
  let firstKeptIndex = 0;

  // First pass: find the latest compaction and determine the "kept" range
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type === "compaction") {
      compaction = entry;
      // Find the index of firstKeptEntryId
      for (let j = 0; j < entries.length; j++) {
        if (entries[j].id === entry.firstKeptEntryId) {
          firstKeptIndex = j;
          break;
        }
      }
    }
  }

  // If there's a compaction, start with the summary
  if (compaction) {
    agentMessages.push({
      role: "user",
      content: `[Context Summary]\n${compaction.summary}`,
      timestamp: Date.now(),
    });
  }

  // Determine which entries to process
  const startIndex = compaction ? firstKeptIndex : 0;
  let entryCount = 0;

  for (let i = startIndex; i < entries.length; i++) {
    const entry = entries[i];
    entryCount++;

    switch (entry.type) {
      case "message": {
        agentMessages.push(entry.message);
        // Track model from assistant messages
        if (entry.message.role === "assistant") {
          model = { provider: entry.message.provider, modelId: entry.message.model };
        }
        break;
      }
      case "custom_message": {
        agentMessages.push({
          role: "custom",
          customType: entry.customType,
          content: entry.content,
          details: entry.details,
          display: entry.display,
          timestamp: Date.parse(entry.timestamp),
        });
        break;
      }
      case "model_change": {
        model = { provider: entry.provider, modelId: entry.modelId };
        break;
      }
      case "compaction": {
        // Already handled above; skip
        break;
      }
      case "custom": {
        // Not in LLM context
        break;
      }
    }
  }

  return { agentMessages, model, entryCount };
}

export function convertAgentMessagesToModelMessages(
  messages: readonly AgentMessage[],
): ModelMessage[] {
  return messages
    .map((message) => {
      switch (message.role) {
        case "custom":
          return customMessageToUserMessage({
            type: "custom_message",
            id: "",
            parentId: null,
            timestamp: String(message.timestamp),
            customType: message.customType,
            content: message.content,
            details: message.details,
            display: message.display,
          });
        case "user":
        case "assistant":
        case "tool":
          return agentMessageToModelMessage(message);
      }
    })
    .filter((message): message is ModelMessage => message !== undefined);
}

// ============================================================================
// AI SDK helpers
// ============================================================================

/** Extract text from an AI SDK ResponseMessage for sending to channel. */
export function extractTextFromResponseMessages(messages: readonly ModelMessage[]): string {
  const texts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") {
      texts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && part.type === "text") {
          texts.push(part.text);
        }
      }
    }
  }
  return texts.join("");
}
