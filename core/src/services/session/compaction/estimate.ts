import type {
  AgentAssistantMessage,
  AgentAssistantContentPart,
  AgentMessage,
  ContentPart,
} from "../session-manager/types";

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Rough token estimate: 1 token ≈ 4 characters.
 * Used when no real usage data is available.
 */
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function contentPartsLength(parts: ContentPart[]): number {
  let len = 0;
  for (const part of parts) {
    if (part.type === "text") {
      len += part.text.length;
    } else {
      // Image parts: approximate with a fixed overhead
      len += 256;
    }
  }
  return len;
}

function assistantContentPartsLength(parts: AgentAssistantContentPart[]): number {
  let len = 0;
  for (const part of parts) {
    switch (part.type) {
      case "text":
        len += part.text.length;
        break;
      case "tool-call":
        len += part.toolName.length + JSON.stringify(part.args).length;
        break;
      case "thinking":
        len += part.text.length;
        break;
    }
  }
  return len;
}

function hasReliableContextUsage(
  msg: AgentMessage,
): msg is AgentAssistantMessage & { usage: { inputTokens: number } } {
  return (
    msg.role === "assistant" &&
    typeof msg.usage?.inputTokens === "number" &&
    Number.isFinite(msg.usage.inputTokens) &&
    msg.usage.inputTokens > 0
  );
}

/**
 * Estimate the token count for a single AgentMessage.
 * Uses the 4-chars-per-token heuristic.
 */
export function estimateTokens(msg: AgentMessage): number {
  switch (msg.role) {
    case "user": {
      const len =
        typeof msg.content === "string" ? msg.content.length : contentPartsLength(msg.content);
      return charsToTokens(len);
    }
    case "assistant": {
      const len =
        typeof msg.content === "string"
          ? msg.content.length
          : assistantContentPartsLength(msg.content);
      return charsToTokens(len);
    }
    case "tool": {
      let len = 0;
      for (const part of msg.content) {
        len += JSON.stringify(part.result).length;
      }
      return charsToTokens(len);
    }
    case "custom": {
      const len =
        typeof msg.content === "string" ? msg.content.length : contentPartsLength(msg.content);
      return charsToTokens(len);
    }
  }
}

// ============================================================================
// Context-Level Estimation
// ============================================================================

/**
 * Estimate total context tokens across a list of AgentMessages.
 *
 * Prefers the last assistant usage record (which carries the actual
 * inputTokens count from the model), then adds rough estimates for any
 * messages that arrived after that usage record.
 */
export function estimateContextTokens(messages: AgentMessage[]): number {
  // Find the last assistant message that has real usage
  let lastUsageIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (hasReliableContextUsage(msg)) {
      lastUsageIdx = i;
      break;
    }
  }

  if (lastUsageIdx === -1) {
    // No usage data — estimate everything
    let total = 0;
    for (const msg of messages) total += estimateTokens(msg);
    return total;
  }

  const usageTokens = (messages[lastUsageIdx] as AgentAssistantMessage).usage!.inputTokens;

  // Add estimates for messages after the last usage record
  let trailing = 0;
  for (let i = lastUsageIdx + 1; i < messages.length; i++) {
    trailing += estimateTokens(messages[i]);
  }

  return usageTokens + trailing;
}
