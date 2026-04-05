import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "@ai-sdk/provider-utils";
import type { JSONValue } from "ai";
import type { OnStepFinishEvent } from "ai";
import type { Logger } from "koishi";

import { AgentSession } from "../agent-session";
import {
  type AgentAssistantMessage,
  type AgentAssistantThinkingPart,
  type AgentTextPart,
  type AgentToolCallPart,
  type AgentUsage,
} from "../session-manager";
import { isSendMessageResult } from "./send-message-tool";

export const PROTOCOL_GUIDANCE_TEXT =
  "[Protocol Guidance]\n" +
  "Visible IM replies must be sent with the send_message tool. " +
  "Your previous assistant text was not delivered to the user. " +
  "Re-issue the full visible reply with send_message, and only set request_heartbeat when you intentionally need another model turn after sending.";

const MAX_PROTOCOL_RETRIES_PER_RESPONSE = 1;

interface ResponseStepProcessorOptions {
  session: AgentSession;
  platform: string;
  channelId: string;
  logger: Logger;
}

export class ResponseStepProcessor {
  private readonly session: AgentSession;
  private readonly platform: string;
  private readonly channelId: string;
  private readonly logger: Logger;
  private seenAssistantToolCallIds = new Set<string>();
  private seenToolResultCallIds = new Set<string>();
  private _pendingProtocolRetry = false;
  private protocolRetryCount = 0;
  private _protocolError = false;
  private _heartbeatRequested = false;
  private _completedSendMessageWithoutHeartbeat = false;
  private _sendFailure = false;
  private _thrownError: string | undefined;

  constructor(options: ResponseStepProcessorOptions) {
    this.session = options.session;
    this.platform = options.platform;
    this.channelId = options.channelId;
    this.logger = options.logger;
  }

  beginResponse(protocolRetry: boolean): void {
    if (!protocolRetry) {
      this.protocolRetryCount = 0;
    }

    this._pendingProtocolRetry = false;
    this._protocolError = false;
    this._heartbeatRequested = false;
    this._completedSendMessageWithoutHeartbeat = false;
    this._sendFailure = false;
    this._thrownError = undefined;
    this.seenAssistantToolCallIds.clear();
    this.seenToolResultCallIds.clear();
  }

  apply(stepResult: OnStepFinishEvent): void {
    const responseMessages = stepResult.response?.messages;
    if (!responseMessages) {
      return;
    }

    this.logger.debug(
      `[step:${this.platform}:${this.channelId}] finish index=${stepResult.stepNumber} reason=${stepResult.finishReason ?? "unknown"}`,
    );

    for (const msg of responseMessages) {
      if (msg.role === "assistant") {
        this.persistAssistantMessage(stepResult, msg.content);
        continue;
      }

      if (msg.role === "tool") {
        this.persistToolResultMessage(msg.content);
      }
    }
  }

  setThrownError(message: string): void {
    this._thrownError = message;
  }

  get pendingProtocolRetry(): boolean {
    return this._pendingProtocolRetry;
  }

  get protocolError(): boolean {
    return this._protocolError;
  }

  get heartbeatRequested(): boolean {
    return this._heartbeatRequested;
  }

  get completedSendMessageWithoutHeartbeat(): boolean {
    return this._completedSendMessageWithoutHeartbeat;
  }

  get sendFailure(): boolean {
    return this._sendFailure;
  }

  get thrownError(): string | undefined {
    return this._thrownError;
  }

  private persistAssistantMessage(
    stepResult: OnStepFinishEvent,
    content: string | unknown[],
  ): void {
    const agentMsg = createAgentAssistantMessage({
      content,
      model: stepResult.model,
      usage: stepResult.usage,
      finishReason: stepResult.finishReason,
    });

    const assistantText = extractAssistantText(agentMsg.content);
    const hasUndeliveredVisibleText =
      assistantText.trim().length > 0 && !hasSendMessageToolCall(agentMsg.content);
    const persistableAgentMsg = hasUndeliveredVisibleText
      ? stripUndeliveredAssistantText(agentMsg)
      : agentMsg;

    if (
      persistableAgentMsg &&
      !isDuplicateAssistantToolCallMessage(persistableAgentMsg, this.seenAssistantToolCallIds)
    ) {
      this.session.appendAssistantMessage({
        id: `${Date.now()}-assistant-${this.seenAssistantToolCallIds.size}`,
        timestamp: persistableAgentMsg.timestamp,
        stage: "runtime",
        visibility: "model",
        materialization: "default",
        message: assistantMessageToModelMessage(persistableAgentMsg),
      });
      rememberAssistantToolCallIds(persistableAgentMsg, this.seenAssistantToolCallIds);
    }

    if (hasUndeliveredVisibleText) {
      this.logger.debug(
        `[step:${this.platform}:${this.channelId}] undelivered assistant text detected protocolRetry=${this.protocolRetryCount < MAX_PROTOCOL_RETRIES_PER_RESPONSE}`,
      );
      this.session.appendStateChange({
        id: `${Date.now()}-protocol-draft`,
        timestamp: Date.now(),
        stage: "runtime",
        visibility: "internal",
        materialization: "internal",
        stateType: "protocol_assistant_draft",
        data: {
          text: assistantText,
          provider: agentMsg.provider,
          model: agentMsg.model,
          finishReason: agentMsg.finishReason,
        },
      });

      if (this.protocolRetryCount < MAX_PROTOCOL_RETRIES_PER_RESPONSE) {
        this.protocolRetryCount++;
        this._pendingProtocolRetry = true;
        this.session.appendSystemNotice({
          id: `${Date.now()}-protocol-guidance`,
          timestamp: Date.now(),
          stage: "runtime",
          visibility: "hidden",
          materialization: "hidden",
          subType: "protocol_guidance",
          materializationKey: "hidden",
          notice: PROTOCOL_GUIDANCE_TEXT,
        });
      } else {
        this._protocolError = true;
      }
    }
  }

  private persistToolResultMessage(content: unknown): void {
    const toolParts = Array.isArray(content)
      ? (content as Array<Record<string, unknown>>).filter((part) => part.type === "tool-result")
      : [];

    if (toolParts.length === 0) {
      return;
    }

    const freshToolParts = toolParts.filter(
      (part) => !this.seenToolResultCallIds.has(String(part.toolCallId)),
    );
    if (freshToolParts.length === 0) {
      return;
    }

    this.logger.debug(
      `[step:${this.platform}:${this.channelId}] tool results=${freshToolParts.length}`,
    );

    this.session.appendToolMessage({
      id: `${Date.now()}-tool-${this.seenToolResultCallIds.size}`,
      timestamp: Date.now(),
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: toolPartsToModelMessage(freshToolParts),
    });

    for (const part of freshToolParts) {
      this.seenToolResultCallIds.add(String(part.toolCallId));
    }

    for (const part of freshToolParts) {
      if (part.toolName !== "send_message") {
        continue;
      }

      const toolResult = unwrapToolResult(part.output);
      if (!isSendMessageResult(toolResult)) {
        continue;
      }

      this.logger.debug(
        `[step:${this.platform}:${this.channelId}] send_message success=${toolResult.success} segments=${toolResult.segments.length} heartbeat=${toolResult.requestHeartbeat}`,
      );

      if (toolResult.success === true) {
        this._heartbeatRequested = toolResult.requestHeartbeat;
        if (!toolResult.requestHeartbeat) {
          this._completedSendMessageWithoutHeartbeat = true;
        }
      }

      if (toolResult.success === false && toolResult.segments.length === 0) {
        this._protocolError = true;
      }

      const firstErrorSegment = toolResult.segments.find(
        (segment) => segment.success === false || Boolean(segment.error),
      );
      if (toolResult.success === false && firstErrorSegment) {
        this._sendFailure = true;
        if (firstErrorSegment.error && !this._thrownError) {
          this._thrownError = firstErrorSegment.error;
        }
      }
    }
  }
}

function createAgentUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): AgentUsage | undefined {
  if (!usage || !hasNonZeroUsageValue(usage)) return undefined;

  const usageRecord = usage;
  const inputTokens = usageRecord.inputTokens ?? 0;
  const outputTokens = usageRecord.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usageRecord.totalTokens ?? inputTokens + outputTokens,
    cacheRead: usageRecord.cacheRead ?? 0,
    cacheWrite: usageRecord.cacheWrite ?? 0,
  };
}

function assistantMessageToModelMessage(message: AgentAssistantMessage): AssistantModelMessage {
  if (typeof message.content === "string") {
    return {
      role: "assistant",
      content: message.content,
    };
  }

  return {
    role: "assistant",
    content: message.content.map((part) => {
      switch (part.type) {
        case "text":
          return { type: "text" as const, text: part.text };
        case "thinking":
          return { type: "reasoning" as const, text: part.text, signature: part.signature };
        case "tool-call":
          return {
            type: "tool-call" as const,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.args,
          };
      }
    }),
  } satisfies AssistantModelMessage;
}

function toolPartsToModelMessage(
  parts: Array<Record<string, unknown>>,
): ToolModelMessage {
  return {
    role: "tool",
    content: parts.map((part) => ({
      type: "tool-result" as const,
      toolCallId: part.toolCallId as string,
      toolName: part.toolName as string,
      output: { type: "json" as const, value: unwrapToolResult(part.output) as JSONValue },
      isError: part.isError as boolean | undefined,
    })),
  };
}

export function getReliableInputTokens(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): number | undefined {
  if (typeof usage?.inputTokens !== "number") {
    return undefined;
  }

  if (!Number.isFinite(usage.inputTokens) || usage.inputTokens <= 0) {
    return undefined;
  }

  return usage.inputTokens;
}

function hasNonZeroUsageValue(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): boolean {
  if (!usage) {
    return false;
  }

  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.cacheRead,
    usage.cacheWrite,
  ].some((value) => typeof value === "number" && Number.isFinite(value) && value !== 0);
}

function extractAssistantText(content: AgentAssistantMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part): part is AgentTextPart => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function hasSendMessageToolCall(content: AgentAssistantMessage["content"]): boolean {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => part.type === "tool-call" && part.toolName === "send_message");
}

function stripUndeliveredAssistantText(
  message: AgentAssistantMessage,
): AgentAssistantMessage | undefined {
  if (!Array.isArray(message.content)) {
    return undefined;
  }

  const content = message.content.filter(
    (part): part is AgentToolCallPart | AgentAssistantThinkingPart => part.type !== "text",
  );
  if (content.length === 0) {
    return undefined;
  }

  return {
    ...message,
    content,
  };
}

function getAssistantToolCallIds(content: AgentAssistantMessage["content"]): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((part): part is AgentToolCallPart => part.type === "tool-call")
    .map((part) => part.toolCallId);
}

function hasVisibleAssistantText(content: AgentAssistantMessage["content"]): boolean {
  return extractAssistantText(content).trim().length > 0;
}

function isDuplicateAssistantToolCallMessage(
  message: AgentAssistantMessage,
  seenToolCallIds: ReadonlySet<string>,
): boolean {
  const toolCallIds = getAssistantToolCallIds(message.content);
  if (toolCallIds.length === 0) {
    return false;
  }

  return (
    !hasVisibleAssistantText(message.content) && toolCallIds.every((id) => seenToolCallIds.has(id))
  );
}

function rememberAssistantToolCallIds(
  message: AgentAssistantMessage,
  seenToolCallIds: Set<string>,
): void {
  for (const toolCallId of getAssistantToolCallIds(message.content)) {
    seenToolCallIds.add(toolCallId);
  }
}

function unwrapToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as { type?: unknown; value?: unknown };
  if (candidate.type === "json") {
    return candidate.value;
  }

  return value;
}

export function hasCompletedSendMessageWithoutHeartbeat(
  steps: Array<{ toolResults?: unknown[] }>,
): boolean {
  const lastStep = steps[steps.length - 1];
  if (!lastStep || !Array.isArray(lastStep.toolResults)) {
    return false;
  }

  return lastStep.toolResults.some((result) => {
    if (!result || typeof result !== "object") {
      return false;
    }

    const candidate = result as { toolName?: unknown; output?: unknown };
    if (candidate.toolName !== "send_message") {
      return false;
    }

    const output = unwrapToolResult(candidate.output);
    return (
      isSendMessageResult(output) && output.success === true && output.requestHeartbeat === false
    );
  });
}

/** Normalize AI SDK AssistantContent into AgentAssistantMessage content parts. */
export function normalizeAssistantContent(
  content: unknown[],
): Array<AgentTextPart | AgentToolCallPart | AgentAssistantThinkingPart> {
  if (!Array.isArray(content)) return [];
  const parts: Array<AgentTextPart | AgentToolCallPart | AgentAssistantThinkingPart> = [];
  for (const part of content) {
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push({ type: "text", text: p.text });
    } else if (p.type === "tool-call") {
      parts.push({
        type: "tool-call",
        toolCallId: p.toolCallId as string,
        toolName: p.toolName as string,
        args: p.input ?? p.args,
      });
    } else if ((p.type === "reasoning" || p.type === "thinking") && typeof p.text === "string") {
      parts.push({
        type: "thinking",
        text: p.text,
        signature: typeof p.signature === "string" ? p.signature : undefined,
      });
    }
  }
  return parts;
}

export function createAgentAssistantMessage(input: {
  content: string | unknown[];
  model?: { provider?: string; modelId?: string };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  finishReason?: string;
}): AgentAssistantMessage {
  const usageRecord = input.usage as Record<string, unknown> | undefined;
  const usage = createAgentUsage({
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    totalTokens: input.usage?.totalTokens,
    cacheRead: typeof usageRecord?.cacheRead === "number" ? usageRecord.cacheRead : 0,
    cacheWrite: typeof usageRecord?.cacheWrite === "number" ? usageRecord.cacheWrite : 0,
  });

  return {
    role: "assistant",
    content:
      typeof input.content === "string" ? input.content : normalizeAssistantContent(input.content),
    timestamp: Date.now(),
    provider: input.model?.provider ?? "unknown",
    model: input.model?.modelId ?? "unknown",
    usage,
    finishReason: input.finishReason,
  };
}

export function buildRuntimeModelMessages(
  session: AgentSession,
  instructions: string,
  options: {
    followUpReview?: string;
    protocolRetry?: boolean;
  } = {},
): ModelMessage[] {
  const modelMessages = [...session.getModelMessages()];

  if (options.followUpReview) {
    modelMessages.push({
      role: "user",
      content: options.followUpReview,
    });
  }

  if (options.protocolRetry) {
    modelMessages.push({
      role: "user",
      content: PROTOCOL_GUIDANCE_TEXT,
    });
  }

  return [{ role: "system", content: instructions }, ...modelMessages];
}

export function buildGenerateInputForTest(input: {
  instructions: string;
  session: AgentSession;
}): { messages: ModelMessage[] } {
  if (!(input.session instanceof AgentSession)) {
    throw new Error("buildGenerateInputForTest requires a live AgentSession");
  }

  return {
    messages: buildRuntimeModelMessages(input.session, input.instructions),
  };
}
