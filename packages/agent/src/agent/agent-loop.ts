import { safeValidateTypes, ToolResultOutput, type TextPart } from "@ai-sdk/provider-utils";
import { JSONValue, streamText, type ToolSet } from "ai";

import { EventStream } from "./event-stream.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentToolCall,
  AgentToolResult,
  AssistantMessage,
  AssistantMessageEvent,
  ToolMessage,
} from "./types.js";

const DEFAULT_MAX_STEPS = 20;

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): EventStream<AgentEvent, AgentMessage[]> {
  const stream = createAgentStream();
  void runAgentLoop(prompts, context, config, (event) => stream.push(event), signal)
    .then((messages) => {
      stream.end(messages);
    })
    .catch((error) => {
      stream.error(error);
    });
  return stream;
}

export function agentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): EventStream<AgentEvent, AgentMessage[]> {
  validateContinuationContext(context);
  const stream = createAgentStream();
  void runAgentLoopContinue(context, config, (event) => stream.push(event), signal)
    .then((messages) => {
      stream.end(messages);
    })
    .catch((error) => {
      stream.error(error);
    });
  return stream;
}

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, newMessages, config, emit, signal);
  return newMessages;
}

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
): Promise<AgentMessage[]> {
  validateContinuationContext(context);

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  await runLoop(currentContext, newMessages, config, emit, signal);
  return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event) => event.type === "agent_end",
    (event) => (event.type === "agent_end" ? event.messages : []),
  );
}

function validateContinuationContext(context: AgentContext): void {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  if (context.messages.at(-1)?.role === "assistant") {
    throw new Error("Cannot continue from message role: assistant");
  }
}

async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
): Promise<void> {
  let firstTurn = true;
  let step = 0;
  let pendingMessages = config.skipInitialSteeringPoll
    ? []
    : ((await config.getSteeringMessages?.()) ?? []);

  while (true) {
    let hasMoreToolCalls = true;
    let terminatedByTools = false;

    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!firstTurn) {
        await emit({ type: "turn_start" });
      } else {
        firstTurn = false;
      }

      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      step += 1;
      if (step > (config.maxSteps ?? DEFAULT_MAX_STEPS)) {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      const assistant = await streamAssistantResponse(currentContext, config, emit, signal);
      currentContext.messages.push(assistant);
      newMessages.push(assistant);

      if (assistant.finishReason === "error" || assistant.finishReason === "abort") {
        await emit({ type: "turn_end", message: assistant, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      const toolCalls = getToolCalls(assistant);
      const toolResults: ToolMessage[] = [];
      hasMoreToolCalls = false;

      if (toolCalls.length > 0) {
        const executedBatch = await executeToolCalls(
          currentContext,
          assistant,
          config,
          signal,
          emit,
        );
        toolResults.push(...executedBatch.messages);
        hasMoreToolCalls = !executedBatch.terminate;
        terminatedByTools = executedBatch.terminate;
        for (const result of toolResults) {
          newMessages.push(result);
        }
      }

      await emit({
        type: "turn_end",
        message: assistant,
        toolResults: toolResults.flatMap((message) => message.content),
      });
      if (terminatedByTools) {
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }
      pendingMessages = (await config.getSteeringMessages?.()) ?? [];
    }

    const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }

    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}

async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  const llmMessages = await config.convertToLlm(messages);
  const assistant = createAssistantMessage();
  let reasoningText = "";
  let toolInputState: { id: string; toolName: string; inputText: string } | undefined;

  await emit({ type: "message_start", message: assistant });

  const response = await streamText({
    model: config.model,
    system: context.systemPrompt,
    messages: llmMessages,
    abortSignal: signal,
    tools: context.tools
      ? (Object.fromEntries(
          Object.entries(context.tools).map(([name, { execute: _, ...rest }]) => [name, rest]),
        ) as ToolSet)
      : undefined,
  });

  for await (const event of response.fullStream) {
    switch (event.type) {
      case "text-delta": {
        const lastPart = assistant.content.at(-1);
        if (lastPart?.type === "text") {
          (lastPart as TextPart).text += event.text;
        } else {
          assistant.content.push({ type: "text", text: event.text });
        }
        await emit({ type: "message_update", message: assistant, assistantMessageEvent: event });
        break;
      }
      case "reasoning-delta":
        reasoningText += event.text;
        await emit({ type: "message_update", message: assistant, assistantMessageEvent: event });
        break;
      case "reasoning-end":
        if (reasoningText.length > 0) {
          assistant.content.push({ type: "reasoning", text: reasoningText });
          reasoningText = "";
        }
        await emit({ type: "message_update", message: assistant, assistantMessageEvent: event });
        break;
      case "tool-call":
        if (reasoningText.length > 0) {
          assistant.content.push({ type: "reasoning", text: reasoningText });
          reasoningText = "";
        }
        toolInputState = undefined;
        assistant.content.push(event);
        await emit({
          type: "message_update",
          message: assistant,
          assistantMessageEvent: event as AssistantMessageEvent,
        });
        break;
      case "tool-input-start":
        toolInputState = { id: event.id, toolName: event.toolName, inputText: "" };
        await emit({ type: "message_update", message: assistant, assistantMessageEvent: event });
        break;
      case "tool-input-delta":
        if (toolInputState?.id === event.id) {
          toolInputState.inputText += event.delta;
        }
        await emit({ type: "message_update", message: assistant, assistantMessageEvent: event });
        break;
      case "tool-input-end":
        if (toolInputState?.id === event.id) {
          if (toolInputState.inputText.length > 0) {
            try {
              assistant.content.push({
                type: "tool-input",
                toolCallId: toolInputState.id,
                toolName: toolInputState.toolName,
                input: JSON.parse(toolInputState.inputText) as Record<string, unknown>,
              } as never);
            } catch {
              // best-effort only; ignore invalid partial JSON
            }
          }
          toolInputState = undefined;
        }
        await emit({ type: "message_update", message: assistant, assistantMessageEvent: event });
        break;
      case "finish-step":
        assistant.finishReason = event.finishReason;
        assistant.usage = event.usage ?? {};
        break;
      case "abort":
        assistant.finishReason = "abort";
        assistant.errorMessage = stringifyError(event.reason);
        break;
      case "error":
        assistant.finishReason = "error";
        assistant.errorMessage = stringifyError(event.error);
        break;
      default:
        break;
    }
  }

  if (reasoningText.length > 0) {
    assistant.content.push({ type: "reasoning", text: reasoningText });
  }

  assistant.content = (assistant.content as Array<{ type: string }>).filter(
    (part) => part.type !== "tool-input",
  ) as AssistantMessage["content"];

  await emit({ type: "message_end", message: assistant });
  return assistant;
}

async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const toolCalls = getToolCalls(assistantMessage);
  const finalizedCalls: ToolMessage[] = [];
  const terminateVotes: boolean[] = [];

  for (const toolCall of toolCalls) {
    const rawArgs = toolCall.input;
    const tool = currentContext.tools?.[toolCall.toolName];
    const contextSnapshot = createContextSnapshot(currentContext);

    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: rawArgs,
    });

    let result: AgentToolResult;
    let rawResult: unknown;
    let isError = false;
    let args = rawArgs;

    if (tool?.inputSchema) {
      const validation = await safeValidateTypes({
        value: rawArgs,
        schema: tool.inputSchema,
      });
      if (!validation.success) {
        result = createErrorToolResult(validation.error.message);
        isError = true;

        await emit({
          type: "tool_execution_end",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result,
          isError,
        });

        const toolMessage = createToolResultMessage(toolCall, result);
        await emit({ type: "message_start", message: toolMessage });
        await emit({ type: "message_end", message: toolMessage });

        finalizedCalls.push(toolMessage);
        terminateVotes.push(false);
        currentContext.messages.push(toolMessage);
        continue;
      }

      args = validation.value;
    }

    const before = await config.beforeToolCall?.(
      { assistantMessage, toolCall, args, context: contextSnapshot },
      signal,
    );

    if (before?.block) {
      result = createErrorToolResult(before.reason ?? "blocked");
      isError = true;
    } else if (!tool?.execute) {
      result = createErrorToolResult(`Tool ${toolCall.toolName} has no execute handler.`);
      isError = true;
    } else {
      try {
        rawResult = await tool.execute(args, {
          toolCallId: toolCall.toolCallId,
          messages: await config.convertToLlm(currentContext.messages),
          abortSignal: signal,
          experimental_context: contextSnapshot,
        });
        result = normalizeToolResult(rawResult);
      } catch (error) {
        result = createErrorToolResult(stringifyError(error));
        isError = true;
      }
    }

    const after = await config.afterToolCall?.(
      {
        assistantMessage,
        toolCall,
        args,
        result,
        rawResult,
        isError,
        context: contextSnapshot,
      },
      signal,
    );

    const finalResult: AgentToolResult = {
      content: after?.content ?? result.content,
      details: after?.details ?? result.details,
    };
    const finalIsError = after?.isError ?? isError;
    const terminate = after?.terminate ?? false;

    await emit({
      type: "tool_execution_end",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      result: finalResult,
      isError: finalIsError,
    });

    const toolMessage = createToolResultMessage(toolCall, finalResult);
    await emit({ type: "message_start", message: toolMessage });
    await emit({ type: "message_end", message: toolMessage });

    finalizedCalls.push(toolMessage);
    terminateVotes.push(terminate);
    currentContext.messages.push(toolMessage);
  }

  return {
    messages: finalizedCalls,
    terminate: terminateVotes.length > 0 && terminateVotes.every(Boolean),
  };
}

type ExecutedToolCallBatch = {
  messages: ToolMessage[];
  terminate: boolean;
};

function getToolCalls(message: AssistantMessage): AgentToolCall[] {
  return message.content.filter((part): part is AgentToolCall => part.type === "tool-call");
}

function createAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    usage: {},
    finishReason: "stop",
    timestamp: Date.now(),
  };
}

function createContextSnapshot(context: AgentContext): AgentContext {
  return {
    systemPrompt: context.systemPrompt,
    messages: context.messages.slice(),
    tools: context.tools ? { ...context.tools } : undefined,
  };
}

function createErrorToolResult(message: string): AgentToolResult {
  return {
    content: { type: "error-text", value: message },
    details: message,
  };
}

function createToolResultMessage(toolCall: AgentToolCall, result: AgentToolResult): ToolMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: result.content,
      },
    ],
    timestamp: Date.now(),
  };
}

function stringifyError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error === undefined) {
    return "Unknown error";
  }
  return String(error);
}

/** 将工具返回值归一化为 AgentToolResult */
export function normalizeToolResult(result: unknown): AgentToolResult {
  if (
    result !== null &&
    typeof result === "object" &&
    "output" in result &&
    "details" in result &&
    !("type" in result)
  ) {
    return {
      content: toToolResultOutput((result as { output: unknown }).output),
      details: (result as { details: unknown }).details,
    };
  }
  return {
    content: toToolResultOutput(result),
  };
}

function toToolResultOutput(output: unknown): ToolResultOutput {
  if (typeof output === "string") {
    return { type: "text", value: output };
  }
  if (output && typeof output === "object" && "type" in output) {
    const obj = output as { type: string; value?: unknown };
    if (
      (obj.type === "text" || obj.type === "json" || obj.type === "execution-denied") &&
      "value" in obj
    ) {
      return output as ToolResultOutput;
    }
    const { type: _, ...rest } = obj;
    return { type: "json", value: rest as JSONValue };
  }
  return { type: "json", value: output as JSONValue };
}
