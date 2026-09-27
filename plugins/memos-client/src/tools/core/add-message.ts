import { jsonSchema, type FunctionTool } from "koishi-plugin-yesimbot";

import type { MemosCloudClient } from "../../client.js";
import type { MemosClientConfig, MemosIdentity } from "../../types.js";

export type AddMessageToolOutput = { outcome: "persisted" | "accepted"; taskId?: string } | { outcome: "failed"; error: { code: string; message: string } };

export interface AddMessageToolInput {
  content: string;
}

/** `ToolExecutionOptions` no longer carries the turn id, so the runtime publishes it as tool context. */
export interface AddMessageToolContext {
  turnId: string;
}

const TOOL_CONTEXT_SCHEMA = jsonSchema<AddMessageToolContext>({
  type: "object",
  properties: { turnId: { type: "string" } },
  required: ["turnId"],
  additionalProperties: false,
});

export interface AddMessageToolOptions {
  client: MemosCloudClient;
  config: MemosClientConfig;
  resolveIdentity(turnId: string): MemosIdentity;
  now(): Date;
  logger?: { warn(message: string): void };
}

export function createAddMessageTool(options: AddMessageToolOptions): FunctionTool<AddMessageToolInput, AddMessageToolOutput, AddMessageToolContext> {
  return {
    description: "Write a durable long-term memory candidate to MemOS.",
    contextSchema: TOOL_CONTEXT_SCHEMA,
    inputSchema: jsonSchema<AddMessageToolInput>({
      type: "object",
      properties: { content: { type: "string", minLength: 1, description: "Durable memory content to remember." } },
      required: ["content"],
      additionalProperties: false,
    }),
    execute: async ({ content }, execution) => {
      try {
        const identity = options.resolveIdentity(execution.context.turnId);
        const response = await options.client.addMessage<{ task_id?: string; status?: string }>({
          user_id: identity.userId,
          conversation_id: identity.conversationId,
          agent_id: identity.agentId,
          messages: [{ role: "user", content, chat_time: formatChatTime(options.now()) }],
          tags: options.config.tags,
          info: { ...identity.info },
          async_mode: options.config.asyncMode,
          source: "yesimbot",
        });

        return { outcome: options.config.asyncMode ? "accepted" : "persisted", taskId: response.data?.task_id };
      } catch (error) {
        const message = sanitizeErrorMessage(error, options.config.apiKey);
        options.logger?.warn(`MemOS add message failed: ${message}`);
        return { outcome: "failed", error: { code: "request_failed", message } };
      }
    },
  };
}

function formatChatTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sanitizeErrorMessage(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(`Token ${apiKey}`, "Token [REDACTED]").replaceAll(apiKey, "[REDACTED]");
}
