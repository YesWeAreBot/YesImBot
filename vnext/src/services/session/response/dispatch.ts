import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";

import { splitVisibleText } from "./split";
import type { ResponseDispatchConfig, ResponseSendContext } from "./types";

export function bindResponseDispatch(
  session: AgentSession,
  sendCtx: ResponseSendContext,
  config: ResponseDispatchConfig,
  logger?: { debug: (msg: string) => void },
): () => void {
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_end") {
      const fullText = collectAssistantText(event.message);
      if (!fullText) {
        return;
      }

      const markedContent = extractMessageBoundary(fullText);
      if (!markedContent) {
        logger?.debug(`no <message> boundary in output, skipping send for ${sendCtx.channelKey}`);
        return;
      }

      void sendTextToChannel(markedContent, sendCtx, config, logger);
    }
  });

  return unsubscribe;
}

function collectAssistantText(message: AgentMessage): string {
  if (!message || message.role !== "assistant") {
    return "";
  }

  const textParts: string[] = [];
  for (const block of message.content) {
    if (block.type !== "text") {
      continue;
    }
    const trimmed = block.text.trim();
    if (trimmed) {
      textParts.push(trimmed);
    }
  }

  return textParts.join("\n\n");
}

function extractMessageBoundary(text: string): string | null {
  const match = text.match(/<message>([\s\S]*?)<\/message>/);
  return match ? match[1].trim() : null;
}

async function sendTextToChannel(
  text: string,
  sendCtx: ResponseSendContext,
  config: ResponseDispatchConfig,
  logger?: { debug: (msg: string) => void },
): Promise<void> {
  const segments = splitVisibleText(text, config.maxChars);

  for (const segment of segments) {
    try {
      await sendCtx.sendFn(segment);
      logger?.debug(`sent segment to ${sendCtx.channelKey}, length=${segment.length}`);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendCtx.injectSystemMessage(`Failed to deliver message: ${errorMsg}`);
      logger?.debug(`failed to send to ${sendCtx.channelKey}: ${errorMsg}`);
    }
  }
}
