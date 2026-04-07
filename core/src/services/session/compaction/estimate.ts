import type { ModelMessage } from "@ai-sdk/provider-utils";

type UsageCarrier = {
  role: string;
  usage?: {
    inputTokens?: number;
  };
};

type CompactionMessage =
  | ModelMessage
  | {
      role: "custom";
      content: string | readonly unknown[];
      usage?: {
        inputTokens?: number;
      };
    }
  | {
      role: "assistant";
      content: unknown;
      usage?: {
        inputTokens?: number;
      };
    };

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function hasReliableContextUsage(
  message: CompactionMessage,
): message is CompactionMessage & UsageCarrier {
  const usage = (message as UsageCarrier).usage;

  return (
    message.role === "assistant" &&
    typeof usage?.inputTokens === "number" &&
    Number.isFinite(usage.inputTokens) &&
    usage.inputTokens > 0
  );
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content ?? "");
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!part || typeof part !== "object") {
        return JSON.stringify(part);
      }

      if ("type" in part) {
        switch (part.type) {
          case "text":
          case "thinking":
            return typeof part.text === "string" ? part.text : JSON.stringify(part);
          case "tool-call": {
            const toolName = typeof part.toolName === "string" ? part.toolName : "tool";
            return `${toolName}${JSON.stringify(part.args ?? {})}`;
          }
          case "tool-result":
            return JSON.stringify(part.result ?? null);
          default:
            return JSON.stringify(part);
        }
      }

      return JSON.stringify(part);
    })
    .join("\n");
}

export function estimateTokens(message: CompactionMessage): number {
  return charsToTokens(stringifyMessageContent(message.content).length);
}

export function estimateContextTokens(messages: readonly CompactionMessage[]): number {
  let lastUsageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (hasReliableContextUsage(messages[i])) {
      lastUsageIndex = i;
      break;
    }
  }

  if (lastUsageIndex === -1) {
    return messages.reduce((total, message) => total + estimateTokens(message), 0);
  }

  const usageTokens = (messages[lastUsageIndex] as UsageCarrier).usage?.inputTokens ?? 0;
  const trailingTokens = messages
    .slice(lastUsageIndex + 1)
    .reduce((total, message) => total + estimateTokens(message), 0);

  return usageTokens + trailingTokens;
}
