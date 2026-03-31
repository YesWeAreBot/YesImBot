import { randomUUID } from "node:crypto";

import { jsonSchema } from "@ai-sdk/provider-utils";
import type { Bot } from "koishi";

interface SendMessageToolInput {
  inner_thoughts?: string;
  content?: string;
  segments?: string[];
  request_heartbeat?: boolean;
}

interface SendMessageToolOptions {
  bot: Bot;
  channelId: string;
}

export interface SendMessageSegmentResult {
  segmentId: string;
  index: number;
  content: string;
  success: boolean;
  messageIds?: string[];
  error?: string;
}

export interface SendMessageResult {
  toolCallId: string;
  utteranceId: string;
  requestHeartbeat: boolean;
  success: boolean;
  segments: SendMessageSegmentResult[];
}

const INVALID_SEND_MESSAGE_TEXT = "send_message requires at least one non-empty segment";

function resolveToolCallId(options: unknown): string {
  if (options && typeof options === "object") {
    const candidate = (options as { toolCallId?: unknown }).toolCallId;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return randomUUID();
}

function normalizeSegments(input: SendMessageToolInput): string[] {
  if (Array.isArray(input.segments) && input.segments.length > 0) {
    return input.segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  }

  if (typeof input.content === "string") {
    return input.content
      .split("<sep/>")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }

  return [];
}

function buildFailureResult(options: {
  toolCallId: string;
  utteranceId: string;
  requestHeartbeat: boolean;
  segments?: SendMessageSegmentResult[];
}): SendMessageResult {
  return {
    toolCallId: options.toolCallId,
    utteranceId: options.utteranceId,
    requestHeartbeat: options.requestHeartbeat,
    success: false,
    segments: options.segments ?? [],
  };
}

export function isSendMessageResult(value: unknown): value is SendMessageResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.toolCallId === "string" &&
    typeof candidate.utteranceId === "string" &&
    typeof candidate.requestHeartbeat === "boolean" &&
    typeof candidate.success === "boolean" &&
    Array.isArray(candidate.segments)
  );
}

export function createSendMessageTool(options: SendMessageToolOptions) {
  return {
    description:
      "Send a message to the channel. You can provide the message content as a single string or split it into multiple segments. If both 'content' and 'segments' are provided, 'segments' will take precedence.",
    inputSchema: jsonSchema<SendMessageToolInput>({
      type: "object",
      additionalProperties: false,
      properties: {
        inner_thoughts: {
          type: "string",
          description: "Deep inner monologue private to you only.",
        },
        content: {
          type: "string",
          description: "The message content. You can use <sep/> to indicate segment breaks.",
        },
        segments: {
          type: "array",
          items: { type: "string" },
          description: "An array of message segments.",
        },
        request_heartbeat: { type: "boolean" },
      },
    }),
    execute: async (input: SendMessageToolInput, executionOptions?: unknown) => {
      const requestHeartbeat = input.request_heartbeat ?? false;
      const toolCallId = resolveToolCallId(executionOptions);
      const utteranceId = randomUUID();
      const normalizedSegments = normalizeSegments(input);

      if (normalizedSegments.length === 0) {
        return buildFailureResult({
          toolCallId,
          utteranceId,
          requestHeartbeat,
        });
      }

      const segmentResults: SendMessageSegmentResult[] = [];
      for (const [index, content] of normalizedSegments.entries()) {
        const segmentId = `${utteranceId}:${index}`;
        try {
          const messageIds = await options.bot.sendMessage(options.channelId, content);
          segmentResults.push({
            segmentId,
            index,
            content,
            success: true,
            messageIds,
          });
        } catch (error: unknown) {
          segmentResults.push({
            segmentId,
            index,
            content,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });

          return buildFailureResult({
            toolCallId,
            utteranceId,
            requestHeartbeat,
            segments: segmentResults,
          });
        }
      }

      return {
        toolCallId,
        utteranceId,
        requestHeartbeat,
        success: true,
        segments: segmentResults,
      } satisfies SendMessageResult;
    },
  };
}

export { INVALID_SEND_MESSAGE_TEXT };
