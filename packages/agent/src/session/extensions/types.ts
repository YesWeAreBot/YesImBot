/**
 * Extension system types.
 *
 * Extensions can:
 * - Subscribe to agent lifecycle events
 * - Register LLM-callable tools
 * - Inject context and modify system prompts
 */

import { ToolResultOutput, ToolResultPart } from "@ai-sdk/provider-utils";
import { ImagePart, LanguageModel, TextPart } from "ai";

import { AgentMessage, AgentTool, AssistantMessageEvent } from "../../agent/index.js";
import { CompactionPreparation, CompactionResult } from "../compaction/index.js";
import { EventBus } from "../event-bus.js";
import { CustomMessage } from "../messages.js";
import { CompactionEntry, SessionEntry, SessionManager } from "../session-manager.js";
import { BuildSystemPromptOptions } from "../system-prompt.js";

// ============================================================================
// Extension Context
// ============================================================================

export interface ContextUsage {
  /** Estimated context tokens, or null if unknown (e.g. right after compaction, before next LLM response). */
  tokens: number | null;
  contextWindow: number;
  /** Context usage as percentage of context window, or null if tokens is unknown. */
  percent: number | null;
}

export interface CompactOptions {
  customInstructions?: string;
  onComplete?: (result: CompactionResult) => void;
  onError?: (error: Error) => void;
}

/**
 * Context passed to extension event handlers.
 */
export interface ExtensionContext {
  /** Current working directory */
  cwd: string;
  /** Session manager */
  sessionManager: SessionManager;
  /** Current model (may be undefined) */
  model: LanguageModel | undefined;
  /** Whether the agent is idle (not streaming) */
  isIdle(): boolean;
  /** The current abort signal, or undefined when the agent is not streaming. */
  signal: AbortSignal | undefined;
  /** Abort the current agent operation */
  abort(): void;
  /** Whether there are queued messages waiting */
  hasPendingMessages(): boolean;
  /** Get current context usage for the active model. */
  getContextUsage(): ContextUsage | undefined;
  /** Trigger compaction without awaiting completion. */
  compact(options?: CompactOptions): void;
  /** Get the current effective system prompt. */
  getSystemPrompt(): string;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Tool definition for registerTool().
 */
export type ToolDefinition = AgentTool & {
  name: string;
  /** Optional one-line snippet for the Available tools section in the default system prompt. Custom tools are omitted from that section when this is not provided. */
  promptSnippet?: string;
  /** Optional guideline bullets appended to the default system prompt Guidelines section when this tool is active. */
  promptGuidelines?: string[];
};

// ============================================================================
// Session Events
// ============================================================================

/** Fired when a session is started, loaded, or reloaded */
export interface SessionStartEvent {
  type: "session:start";
  /** Why this session start happened. */
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  /** Previously active session file. Present for "new", "resume", and "fork". */
  previousSessionFile?: string;
}

/** Fired before context compaction (can be cancelled or customized) */
export interface SessionBeforeCompactEvent {
  type: "session:before-compact";
  preparation: CompactionPreparation;
  branchEntries: SessionEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

/** Fired after context compaction */
export interface SessionCompactEvent {
  type: "session:compact";
  compactionEntry: CompactionEntry;
  fromExtension: boolean;
}

/** Fired before an extension runtime is torn down due to quit, reload, or session replacement. */
export interface SessionShutdownEvent {
  type: "session:shutdown";
  reason: "quit" | "reload" | "new" | "resume" | "fork";
  /** Destination session file when shutting down due to session replacement. */
  targetSessionFile?: string;
}

export type SessionEvent =
  | SessionStartEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionShutdownEvent;

// ============================================================================
// Agent Events
// ============================================================================

/** Fired before each LLM call. Can modify messages. */
export interface ContextEvent {
  type: "context:build";
  messages: AgentMessage[];
}

/** Fired before a provider request is sent. Can replace the payload. */
export interface BeforeProviderRequestEvent {
  type: "provider:before-request";
  payload: unknown;
}

/** Fired after a provider response is received and before the response stream is consumed. */
export interface AfterProviderResponseEvent {
  type: "provider:after-response";
  status: number;
  headers: Record<string, string>;
}

/** Fired after user submits prompt but before agent loop. */
export interface BeforeAgentStartEvent {
  type: "agent:before-start";
  /** The raw user prompt text (after expansion). */
  prompt: string;
  /** Images attached to the user prompt, if any. */
  images?: ImagePart[];
  /** The fully assembled system prompt string. */
  systemPrompt: string;
  /** Structured options used to build the system prompt. Extensions can inspect this to understand what Pi loaded without re-discovering resources. */
  systemPromptOptions: BuildSystemPromptOptions;
}

/** Fired when an agent loop starts */
export interface AgentStartEvent {
  type: "agent:start";
}

/** Fired when an agent loop ends */
export interface AgentEndEvent {
  type: "agent:end";
  messages: AgentMessage[];
}

/** Fired at the start of each turn */
export interface TurnStartEvent {
  type: "turn:start";
  turnIndex: number;
  timestamp: number;
}

/** Fired at the end of each turn */
export interface TurnEndEvent {
  type: "turn:end";
  turnIndex: number;
  message: AgentMessage;
  toolResults: ToolResultPart[];
}

/** Fired when a message starts (user, assistant, or toolResult) */
export interface MessageStartEvent {
  type: "message:start";
  message: AgentMessage;
}

/** Fired during assistant message streaming with token-by-token updates */
export interface MessageUpdateEvent {
  type: "message:update";
  message: AgentMessage;
  assistantMessageEvent: AssistantMessageEvent;
}

/** Fired when a message ends */
export interface MessageEndEvent {
  type: "message:end";
  message: AgentMessage;
}

/** Fired when a tool starts executing */
export interface ToolExecutionStartEvent {
  type: "tool:execution:start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

/** Fired when a tool finishes executing */
export interface ToolExecutionEndEvent {
  type: "tool:execution:end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

// ============================================================================
// Tool Events
// ============================================================================

interface ToolCallEventBase {
  type: "tool:call";
  toolCallId: string;
}

export interface CustomToolCallEvent extends ToolCallEventBase {
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Fired before a tool executes. Can block.
 *
 * `event.input` is mutable. Mutate it in place to patch tool arguments before execution.
 * Later `tool_call` handlers see earlier mutations. No re-validation is performed after mutation.
 */
export type ToolCallEvent = CustomToolCallEvent;

interface ToolResultEventBase {
  type: "tool:result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: ToolResultOutput;
  isError: boolean;
}

export interface CustomToolResultEvent extends ToolResultEventBase {
  toolName: string;
  details: unknown;
}

/** Fired after a tool executes. Can modify result. */
export type ToolResultEvent = CustomToolResultEvent;

export function isToolCallEventType(toolName: string, event: ToolCallEvent): boolean {
  return event.toolName === toolName;
}

/** Union of all event types */
export type ExtensionEvent =
  | SessionEvent
  | ContextEvent
  | BeforeProviderRequestEvent
  | AfterProviderResponseEvent
  | BeforeAgentStartEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent
  | ToolCallEvent
  | ToolResultEvent;

// ============================================================================
// Event Results
// ============================================================================

export interface ContextEventResult {
  messages?: AgentMessage[];
}

export type BeforeProviderRequestEventResult = unknown;

export interface ToolCallEventResult {
  /** Block tool execution. To modify arguments, mutate `event.input` in place instead. */
  block?: boolean;
  reason?: string;
}

export interface ToolResultEventResult {
  content?: ToolResultOutput;
  details?: unknown;
  isError?: boolean;
}

export interface BeforeAgentStartEventResult {
  message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">;
  /** Replace the system prompt for this turn. If multiple extensions return this, they are chained. */
  systemPrompt?: string;
}

export interface SessionBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactionResult;
}

// ============================================================================
// Extension API
// ============================================================================

/** Handler function type for events */
// biome-ignore lint/suspicious/noConfusingVoidType: void allows bare return statements
export type ExtensionHandler<E, R = undefined> = (
  event: E,
  ctx: ExtensionContext,
) => Promise<R | void> | R | void;

/**
 * ExtensionAPI passed to extension factory functions.
 */
export interface ExtensionAPI {
  // =========================================================================
  // Event Subscription
  // =========================================================================

  on(event: "session:start", handler: ExtensionHandler<SessionStartEvent>): void;
  on(
    event: "session:before-compact",
    handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
  ): void;
  on(event: "session:compact", handler: ExtensionHandler<SessionCompactEvent>): void;
  on(event: "session:shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
  on(event: "context:build", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
  on(
    event: "provider:before-request",
    handler: ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestEventResult>,
  ): void;
  on(event: "provider:after-response", handler: ExtensionHandler<AfterProviderResponseEvent>): void;
  on(
    event: "agent:before-start",
    handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
  ): void;
  on(event: "agent:start", handler: ExtensionHandler<AgentStartEvent>): void;
  on(event: "agent:end", handler: ExtensionHandler<AgentEndEvent>): void;
  on(event: "turn:start", handler: ExtensionHandler<TurnStartEvent>): void;
  on(event: "turn:end", handler: ExtensionHandler<TurnEndEvent>): void;
  on(event: "message:start", handler: ExtensionHandler<MessageStartEvent>): void;
  on(event: "message:update", handler: ExtensionHandler<MessageUpdateEvent>): void;
  on(event: "message:end", handler: ExtensionHandler<MessageEndEvent>): void;
  on(event: "tool:execution:start", handler: ExtensionHandler<ToolExecutionStartEvent>): void;
  on(event: "tool:execution:end", handler: ExtensionHandler<ToolExecutionEndEvent>): void;
  on(event: "tool:call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
  on(event: "tool:result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;

  // =========================================================================
  // Tool Registration
  // =========================================================================

  /** Register a tool that the LLM can call. */
  registerTool(tool: ToolDefinition): void;

  // =========================================================================
  // Actions
  // =========================================================================

  /** Send a custom message to the session. */
  sendMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): void;

  /**
   * Send a user message to the agent. Always triggers a turn.
   * When the agent is streaming, use deliverAs to specify how to queue the message.
   */
  sendUserMessage(
    content: string | (TextPart | ImagePart)[],
    options?: { deliverAs?: "steer" | "followUp" },
  ): void;

  /** Append a custom entry to the session for state persistence (not sent to LLM). */
  appendEntry<T = unknown>(customType: string, data?: T): void;

  // =========================================================================
  // Session Metadata
  // =========================================================================

  /** Set the session display name (shown in session selector). */
  setSessionName(name: string): void;

  /** Get the current session name, if set. */
  getSessionName(): string | undefined;

  /** Get the list of currently active tool names. */
  getActiveTools(): string[];

  /** Set the active tools by name. */
  setActiveTools(toolNames: string[]): void;

  /** Shared event bus for extension communication. */
  events: EventBus;
}

// ============================================================================
// Loaded Extension Types
// ============================================================================

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

/** Extension factory function type. Supports both sync and async initialization. */
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

/** Cleanup interface for extension bindings */
export interface ExtensionCleanup {
  dispose?(): void | Promise<void>;
}

/** Host-side extension definition */
export interface ExtensionDefinition {
  id: string;
  order?: number;
  setup(api: ExtensionAPI): void | Promise<void> | ExtensionCleanup;
}

/** Session-local binding instance */
export interface ExtensionBinding {
  id: string;
  order: number;
  generation: number;
  handlers: Map<string, HandlerFn[]>;
  tools: Map<string, ToolDefinition>;
  cleanup?: ExtensionCleanup;
}

export type SendMessageHandler = <T = unknown>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
) => void;

export type SendUserMessageHandler = (
  content: string | (TextPart | ImagePart)[],
  options?: { deliverAs?: "steer" | "followUp" },
) => void;

export type AppendEntryHandler = <T = unknown>(customType: string, data?: T) => void;

export type SetSessionNameHandler = (name: string) => void;

export type GetSessionNameHandler = () => string | undefined;

export type GetActiveToolsHandler = () => string[];

export type SetActiveToolsHandler = (toolNames: string[]) => void;

export type RefreshToolsHandler = () => void;

/**
 * Shared state created by loader, used during registration and runtime.
 * Contains flag values (defaults set during registration, CLI values set after).
 */
export interface ExtensionRuntimeState {
  /** Throws when this extension instance is stale after runtime replacement. */
  assertActive: () => void;
  /** Marks this extension instance as stale after runtime replacement or reload. */
  invalidate: (message?: string) => void;
}

/**
 * Action implementations for extension API methods.
 * Provided to runner.initialize(), copied into the shared runtime.
 */
export interface ExtensionActions {
  sendMessage: SendMessageHandler;
  sendUserMessage: SendUserMessageHandler;
  appendEntry: AppendEntryHandler;
  setSessionName: SetSessionNameHandler;
  getSessionName: GetSessionNameHandler;
  getActiveTools: GetActiveToolsHandler;
  setActiveTools: SetActiveToolsHandler;
  refreshTools: RefreshToolsHandler;
}

/**
 * Actions for ExtensionContext (ctx.* in event handlers).
 * Required by all modes.
 */
export interface ExtensionContextActions {
  getModel: () => LanguageModel | undefined;
  isIdle: () => boolean;
  getSignal: () => AbortSignal | undefined;
  abort: () => void;
  hasPendingMessages: () => boolean;
  shutdown: () => void;
  getContextUsage: () => ContextUsage | undefined;
  compact: (options?: CompactOptions) => void;
  getSystemPrompt: () => string;
}

/**
 * Full runtime = state + actions.
 * Created by loader with throwing action stubs, completed by runner.initialize().
 */
export interface ExtensionRuntime extends ExtensionRuntimeState, ExtensionActions {}

/** Loaded extension with all registered items. */
export interface Extension {
  handlers: Map<string, HandlerFn[]>;
  tools: Map<string, ToolDefinition>;
}

// ============================================================================
// Extension Error
// ============================================================================

export interface ExtensionError {
  event: string;
  error: string;
  stack?: string;
}
