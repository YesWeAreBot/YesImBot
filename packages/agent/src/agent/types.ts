import {
  AssistantModelMessage,
  ReasoningPart,
  TextPart,
  Tool,
  ToolCallPart,
  ToolModelMessage,
  ToolResultOutput,
  ToolResultPart,
  UserModelMessage,
} from "@ai-sdk/provider-utils";
import type { FinishReason, LanguageModel, LanguageModelUsage, TextStreamPart, ToolSet } from "ai";

type Awaitable<T> = T | Promise<T>;

export type Message = UserModelMessage | AssistantModelMessage | ToolModelMessage;

export type AssistantMessageEvent = TextStreamPart<{}>;

export interface UserMessage extends UserModelMessage {
  timestamp: number;
}

export type AssistantContent = Array<TextPart | ReasoningPart | ToolCallPart>;

export interface AssistantMessage extends AssistantModelMessage {
  content: AssistantContent;
  provider?: string;
  model?: string;
  usage: Partial<LanguageModelUsage>;
  finishReason: FinishReason | "abort";
  errorMessage?: string;
  timestamp: number;
}

export type ToolContent = Array<ToolResultPart>;

export interface ToolMessage extends ToolModelMessage {
  content: ToolContent;
  timestamp: number;
}

export type AgentToolCall = ToolCallPart;

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: ToolResultOutput;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  context: AgentContext;
}

export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult<unknown>;
  isError: boolean;
  context: AgentContext;
}

export interface AgentLoopConfig {
  model: LanguageModel;
  convertToLlm: (messages: AgentMessage[]) => Awaitable<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Awaitable<AgentMessage[]>;
  getSteeringMessages?: () => Awaitable<AgentMessage[]>;
  getFollowUpMessages?: () => Awaitable<AgentMessage[]>;
  skipInitialSteeringPoll?: boolean;
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Awaitable<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Awaitable<AfterToolCallResult | undefined>;
  maxSteps?: number;
}

export interface CustomAgentMessages {
  // declaration merging hook
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolMessage
  | CustomAgentMessages[keyof CustomAgentMessages];

export interface AgentState {
  systemPrompt: string;
  model: LanguageModel;
  set tools(tools: Record<string, AgentTool>);
  get tools(): Record<string, AgentTool>;
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}

export interface AgentToolResult<T> {
  content: ToolResultOutput;
  details: T;
  terminate?: boolean;
}

export type AgentTool<INPUT = unknown, OUTPUT = unknown> = Tool<INPUT, OUTPUT>;

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: ToolSet;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultPart[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: AgentToolResult<unknown>;
      isError: boolean;
    };
