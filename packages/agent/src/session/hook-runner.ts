/**
 * HookRunner — pure hook dispatcher for the agent runtime.
 *
 * Two categories of hooks:
 *   1. Reducer hooks — chain results, return a value
 *   2. Lifecycle emit — fire-and-forget broadcast, no return value
 *
 * All hooks are fail-open: a throwing handler logs the error and continues.
 * block / cancel / override is expressed via explicit return values.
 */

import type { ImagePart, LanguageModel } from "ai";

import type {
  AfterToolCallResult,
  AgentMessage,
  AgentToolResult,
  BeforeToolCallResult,
} from "../agent/types.js";
import type { CompactionPreparation, CompactionResult } from "./compaction/index.js";
import type { CustomMessage } from "./messages.js";
import type { CompactionEntry, SessionEntry, SessionManager } from "./session-manager.js";

// ============================================================================
// Context passed to every hook handler
// ============================================================================

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface CompactOptions {
  customInstructions?: string;
  onComplete?: (result: CompactionResult) => void;
  onError?: (error: Error) => void;
}

/**
 * Runtime context available inside hook handlers.
 * Values are resolved at call time.
 */
export interface HookContext {
  sessionManager: SessionManager;
  model: LanguageModel | undefined;
  isIdle(): boolean;
  signal: AbortSignal | undefined;
  abort(): void;
  hasPendingMessages(): boolean;
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;
}

// ============================================================================
// Reducer hook event / result types
// ============================================================================

/** beforeAgentStart */
export interface BeforeAgentStartInput {
  prompt: string;
  images?: ImagePart[];
  systemPrompt: string;
}

export interface BeforeAgentStartResult {
  message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">;
  systemPrompt?: string;
}

/** transformContext */
// (messages in → messages out, no event wrapper needed)

/** beforeToolCall */
export interface BeforeToolCallEvent {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

// BeforeToolCallResult is imported from agent/types.ts

/** afterToolCall */
export interface AfterToolCallEvent {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  content: AgentToolResult["content"];
  details: unknown;
  isError: boolean;
}

// AfterToolCallResult is imported from agent/types.ts

/** beforeProviderRequest */
// (payload in → payload out, no event wrapper needed)

/** beforeCompact */
export interface BeforeCompactEvent {
  preparation: CompactionPreparation;
  branchEntries: SessionEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

export interface BeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactionResult;
}

// ============================================================================
// Lifecycle event types (fire-and-forget)
// ============================================================================

export interface AgentStartEvent {
  type: "agent:start";
}

export interface AgentEndEvent {
  type: "agent:end";
  messages: AgentMessage[];
}

export interface TurnStartEvent {
  type: "turn:start";
  turnIndex: number;
  timestamp: number;
}

export interface TurnEndEvent {
  type: "turn:end";
  turnIndex: number;
  message: AgentMessage;
  toolResults: import("@ai-sdk/provider-utils").ToolResultPart[];
}

export interface MessageStartEvent {
  type: "message:start";
  message: AgentMessage;
}

export interface MessageUpdateEvent {
  type: "message:update";
  message: AgentMessage;
  assistantMessageEvent: import("../agent/types.js").AssistantMessageEvent;
}

export interface MessageEndEvent {
  type: "message:end";
  message: AgentMessage;
}

export interface ToolExecutionStartEvent {
  type: "tool:execution:start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecutionEndEvent {
  type: "tool:execution:end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface SessionStartEvent {
  type: "session:start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}

export interface SessionCompactEvent {
  type: "session:compact";
  compactionEntry: CompactionEntry;
  fromExtension: boolean;
}

export interface SessionShutdownEvent {
  type: "session:shutdown";
  reason: "quit" | "reload" | "new" | "resume" | "fork";
  targetSessionFile?: string;
}

export type AgentLifecycleEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent
  | SessionStartEvent
  | SessionCompactEvent
  | SessionShutdownEvent;

// ============================================================================
// Handler function types
// ============================================================================

// biome-ignore lint/suspicious/noConfusingVoidType: void allows bare return statements
type HookHandler<E, R = undefined> = (event: E, ctx: HookContext) => Promise<R | void> | R | void;

export type BeforeAgentStartHandler = HookHandler<BeforeAgentStartInput, BeforeAgentStartResult>;
export type TransformContextHandler = (
  messages: AgentMessage[],
  ctx: HookContext,
) => Promise<AgentMessage[] | void> | AgentMessage[] | void;
export type BeforeToolCallHandler = HookHandler<BeforeToolCallEvent, BeforeToolCallResult>;
export type AfterToolCallHandler = HookHandler<AfterToolCallEvent, AfterToolCallResult>;
export type BeforeProviderRequestHandler = (
  payload: unknown,
  ctx: HookContext,
) => Promise<unknown | void> | unknown | void;
export type BeforeCompactHandler = HookHandler<BeforeCompactEvent, BeforeCompactResult>;
export type LifecycleHandler = (
  event: AgentLifecycleEvent,
  ctx: HookContext,
) => Promise<void> | void;

// ============================================================================
// Error reporting
// ============================================================================

export interface HookError {
  event: string;
  error: string;
  stack?: string;
}

export type HookErrorListener = (error: HookError) => void;

// ============================================================================
// HookRunner
// ============================================================================

// Reducer hook names → handler type mapping
interface ReducerHookMap {
  "agent:before-start": BeforeAgentStartHandler;
  "context:build": TransformContextHandler;
  "tool:call": BeforeToolCallHandler;
  "tool:result": AfterToolCallHandler;
  "provider:before-request": BeforeProviderRequestHandler;
  "session:before-compact": BeforeCompactHandler;
}

export class HookRunner {
  private _handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  private _errorListeners = new Set<HookErrorListener>();
  private _getContext: () => HookContext;

  /**
   * @param getContext — factory for the HookContext passed to every handler.
   *   Called once per top-level dispatch so handlers see live values.
   */
  constructor(getContext: () => HookContext) {
    this._getContext = getContext;
  }

  // =========================================================================
  // Internal registration API (used by core's ExtensionService)
  // =========================================================================

  /** Register a handler for a named event. */
  on<K extends keyof ReducerHookMap>(event: K, handler: ReducerHookMap[K]): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void {
    const list = this._handlers.get(event) ?? [];
    list.push(handler);
    this._handlers.set(event, list);
  }

  /** Remove all registered handlers. */
  clear(): void {
    this._handlers.clear();
  }

  // =========================================================================
  // Error reporting
  // =========================================================================

  onError(listener: HookErrorListener): () => void {
    this._errorListeners.add(listener);
    return () => this._errorListeners.delete(listener);
  }

  emitError(error: HookError): void {
    for (const listener of this._errorListeners) {
      listener(error);
    }
  }

  hasHandlers(event: string): boolean {
    const list = this._handlers.get(event);
    return !!list && list.length > 0;
  }

  // =========================================================================
  // Reducer hooks — chain results
  // =========================================================================

  async beforeAgentStart(
    input: BeforeAgentStartInput,
  ): Promise<
    | { messages?: NonNullable<BeforeAgentStartResult["message"]>[]; systemPrompt?: string }
    | undefined
  > {
    const ctx = this._getContext();
    let currentSystemPrompt = input.systemPrompt;
    const messages: NonNullable<BeforeAgentStartResult["message"]>[] = [];
    let modified = false;

    for (const handler of this._getHandlers("agent:before-start")) {
      try {
        const event: BeforeAgentStartInput = {
          ...input,
          systemPrompt: currentSystemPrompt,
        };
        const result = await (handler as BeforeAgentStartHandler)(event, ctx);
        if (result) {
          if (result.message) messages.push(result.message);
          if (result.systemPrompt !== undefined) {
            currentSystemPrompt = result.systemPrompt;
            modified = true;
          }
        }
      } catch (err) {
        this._reportError("agent:before-start", err);
      }
    }

    if (messages.length > 0 || modified) {
      return {
        messages: messages.length > 0 ? messages : undefined,
        systemPrompt: modified ? currentSystemPrompt : undefined,
      };
    }
    return undefined;
  }

  async transformContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const ctx = this._getContext();
    let current = structuredClone(messages);

    for (const handler of this._getHandlers("context:build")) {
      try {
        const result = await (handler as TransformContextHandler)(current, ctx);
        if (result) current = result;
      } catch (err) {
        this._reportError("context:build", err);
      }
    }
    return current;
  }

  async beforeToolCall(event: BeforeToolCallEvent): Promise<BeforeToolCallResult | undefined> {
    const ctx = this._getContext();
    for (const handler of this._getHandlers("tool:call")) {
      try {
        const result = await (handler as BeforeToolCallHandler)(event, ctx);
        if (result?.block) return result;
      } catch (err) {
        this._reportError("tool:call", err);
      }
    }
    return undefined;
  }

  async afterToolCall(event: AfterToolCallEvent): Promise<AfterToolCallResult | undefined> {
    const ctx = this._getContext();
    const current = { ...event };
    let modified = false;

    for (const handler of this._getHandlers("tool:result")) {
      try {
        const result = await (handler as AfterToolCallHandler)(current, ctx);
        if (result) {
          if (result.content !== undefined) {
            current.content = result.content;
            modified = true;
          }
          if (result.details !== undefined) {
            current.details = result.details;
            modified = true;
          }
          if (result.isError !== undefined) {
            current.isError = result.isError;
            modified = true;
          }
        }
      } catch (err) {
        this._reportError("tool:result", err);
      }
    }

    return modified
      ? { content: current.content, details: current.details, isError: current.isError }
      : undefined;
  }

  async beforeProviderRequest(payload: unknown): Promise<unknown> {
    const ctx = this._getContext();
    let current = payload;

    for (const handler of this._getHandlers("provider:before-request")) {
      try {
        const result = await (handler as BeforeProviderRequestHandler)(current, ctx);
        if (result !== undefined) current = result;
      } catch (err) {
        this._reportError("provider:before-request", err);
      }
    }
    return current;
  }

  async beforeCompact(event: BeforeCompactEvent): Promise<BeforeCompactResult | undefined> {
    const ctx = this._getContext();
    for (const handler of this._getHandlers("session:before-compact")) {
      try {
        const result = await (handler as BeforeCompactHandler)(event, ctx);
        if (result?.cancel) return result;
        if (result?.compaction) return result;
      } catch (err) {
        this._reportError("session:before-compact", err);
      }
    }
    return undefined;
  }

  // =========================================================================
  // Lifecycle emit — fire-and-forget
  // =========================================================================

  async emitLifecycle(event: AgentLifecycleEvent): Promise<void> {
    const ctx = this._getContext();
    for (const handler of this._getHandlers(event.type)) {
      try {
        await (handler as LifecycleHandler)(event, ctx);
      } catch (err) {
        this._reportError(event.type, err);
      }
    }
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  private *_getHandlers(event: string): Generator<(...args: unknown[]) => unknown> {
    const list = this._handlers.get(event);
    if (list) {
      for (const h of list) yield h;
    }
  }

  private _reportError(event: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.emitError({ event, error: message, stack });
  }
}
