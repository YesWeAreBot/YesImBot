import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ImagePart, LanguageModel, LanguageModelMiddleware, TextPart } from "ai";
import { wrapLanguageModel } from "ai";

import { Agent } from "../agent/agent.js";
import {
  AgentEvent,
  AgentMessage,
  AgentState,
  AgentTool,
  AssistantMessage,
  Message,
} from "../agent/types.js";
import {
  calculateContextTokens,
  compact,
  type CompactionPrompts,
  type CompactionResult,
  CompactionSettings,
  DEFAULT_COMPACTION_PROMPTS,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
} from "./compaction/index.js";
import { createEventBus } from "./event-bus.js";
import { createExtensionRuntime } from "./extensions/loader.js";
import {
  emitSessionShutdownEvent,
  ExtensionErrorListener,
  ExtensionRunner,
} from "./extensions/runner.js";
import {
  ContextUsage,
  ExtensionDefinition,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  SessionBeforeCompactResult,
  SessionStartEvent,
  ToolDefinition,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "./extensions/types.js";
import type { BuildSystemPromptOptions } from "./extensions/types.js";
import type { CustomMessage } from "./messages.js";
import type { CompactionEntry, SessionManager } from "./session-manager.js";
import { getLatestCompactionEntry, type SessionHeader } from "./session-manager.js";
import type { SettingsManager } from "./settings-manager.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
  | AgentEvent
  | {
      type: "queue_update";
      steering: readonly string[];
      followUp: readonly string[];
    }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      result: CompactionResult | undefined;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for auto-retry behavior on transient errors.
 */
export interface RetrySettings {
  /** Whether auto-retry is enabled. Default: true */
  enabled: boolean;
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (doubled each attempt). Default: 2000 */
  baseDelayMs: number;
  /** Maximum delay in ms before giving up. Default: 60000 */
  maxDelayMs: number;
}

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  cwd: string;
  /** Settings manager for dual-scope settings persistence */
  settingsManager: SettingsManager;
  /** SDK custom tools registered outside extensions */
  customTools?: Map<string, ToolDefinition>;
  /** Initial active built-in tool names. Default: [read, bash, edit, write] */
  initialActiveToolNames?: string[];
  /** Optional allowlist of tool names. When provided, only these tool names are exposed. */
  allowedToolNames?: string[];
  /**
   * Override base tools (useful for custom runtimes).
   *
   * These are synthesized into minimal ToolDefinitions internally so AgentSession can keep
   * a definition-first registry even when callers provide plain AgentTool instances.
   */
  baseToolsOverride?: Map<string, AgentTool>;
  /** Mutable ref used by Agent to access the current ExtensionRunner */
  extensionRunnerRef?: { current?: ExtensionRunner };
  /** Session start event metadata emitted when extensions bind to this runtime. */
  sessionStartEvent?: SessionStartEvent;
  /** Extension definitions list, provided by core or ExtensionRegistry */
  extensions?: ExtensionDefinition[];
  /** Customizable compaction prompts. Overrides settings and defaults. */
  compactionPrompts?: CompactionPrompts;
}

export interface ExtensionBindings {
  onError?: ExtensionErrorListener;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
  /** Image attachments */
  images?: ImagePart[];
  /** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
  streamingBehavior?: "steer" | "followUp";
}

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;

  // Event subscription state
  private _unsubscribeAgent?: () => void;
  private _eventListeners: AgentSessionEventListener[] = [];
  private _agentEventQueue: Promise<void> = Promise.resolve();

  /** Tracks pending steering messages for UI display. Removed when delivered. */
  private _steeringMessages: string[] = [];
  /** Tracks pending follow-up messages for UI display. Removed when delivered. */
  private _followUpMessages: string[] = [];
  /** Messages queued to be included with the next user prompt as context ("asides"). */
  private _pendingNextTurnMessages: CustomMessage[] = [];

  // Compaction state
  private _compactionAbortController: AbortController | undefined = undefined;
  private _autoCompactionAbortController: AbortController | undefined = undefined;
  private _overflowRecoveryAttempted = false;
  /** Prevents the context-window-limit check from running more than once per prompt cycle. */
  private _contextWindowCheckDone = false;

  // Branch summarization state
  private _branchSummaryAbortController: AbortController | undefined = undefined;

  // Retry state
  private _retryAbortController: AbortController | undefined = undefined;
  private _retryAttempt = 0;
  private _retryPromise: Promise<void> | undefined = undefined;
  private _retryResolve: (() => void) | undefined = undefined;

  // Bash execution state
  private _bashAbortController: AbortController | undefined = undefined;

  // Extension system
  private _extensionRunner!: ExtensionRunner;
  private _extensions: ExtensionDefinition[];
  private _turnIndex = 0;

  private _customTools: Map<string, ToolDefinition>;
  private _baseToolDefinitions: Map<string, ToolDefinition> = new Map();
  private _cwd: string;
  private _extensionRunnerRef?: { current?: ExtensionRunner };
  private _initialActiveToolNames?: string[];
  private _allowedToolNames?: Set<string>;
  private _baseToolsOverride?: Map<string, AgentTool>;
  private _sessionStartEvent: SessionStartEvent;

  private _extensionErrorListener?: ExtensionErrorListener;
  private _extensionErrorUnsubscriber?: () => void;

  // Tool registry for extension getTools/setTools
  private _toolRegistry: Map<string, AgentTool> = new Map();
  private _toolDefinitions: Map<string, ToolDefinition> = new Map();
  private _toolPromptSnippets: Map<string, string> = new Map();
  private _toolPromptGuidelines: Map<string, string[]> = new Map();

  private _settingsManager: SettingsManager;
  private _retrySettings!: RetrySettings;
  private _compactionSettings: CompactionSettings;
  private _compactionPrompts: CompactionPrompts;
  private _contextWindow: number;

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this._customTools = config.customTools ?? new Map();
    this._cwd = config.cwd;
    this._extensionRunnerRef = config.extensionRunnerRef;
    this._initialActiveToolNames = config.initialActiveToolNames;
    this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
    this._baseToolsOverride = config.baseToolsOverride;
    this._extensions = config.extensions ?? [];
    this._sessionStartEvent = config.sessionStartEvent ?? {
      type: "session:start",
      reason: "startup",
    };

    // Read settings from SettingsManager
    this._settingsManager = config.settingsManager;
    const settings = this._settingsManager.settings;
    this._contextWindow = settings.contextWindow ?? 128000;
    this._compactionSettings = {
      enabled: settings.compaction?.enabled ?? true,
      reserveTokens: settings.compaction?.reserveTokens ?? 16384,
      keepRecentTokens: settings.compaction?.keepRecentTokens ?? 20000,
    };
    // Merge compaction prompts: Config > Settings > defaults
    this._compactionPrompts = {
      ...DEFAULT_COMPACTION_PROMPTS,
      ...(settings.compaction?.prompts ?? {}),
      ...(config.compactionPrompts ?? {}),
    };
    this._retrySettings = {
      enabled: settings.retry?.enabled ?? true,
      maxRetries: settings.retry?.maxRetries ?? 3,
      baseDelayMs: settings.retry?.baseDelayMs ?? 2000,
      maxDelayMs: settings.retry?.maxDelayMs ?? 60000,
    };

    if (settings.steeringMode) {
      this.agent.steeringMode = settings.steeringMode;
    }
    if (settings.followUpMode) {
      this.agent.followUpMode = settings.followUpMode;
    }

    // Restore persisted messages from SessionManager into Agent state.
    // This ensures historical messages (before restart) are available in LLM context.
    // buildSessionContext() handles: regular messages, custom messages, compaction summaries.
    const sessionContext = this.sessionManager.buildSessionContext();
    if (sessionContext.messages.length > 0) {
      this.agent.state.messages = sessionContext.messages;
    }

    // Always subscribe to agent events for internal handling
    // (session persistence, extensions, auto-compaction, retry logic)
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
    this._installAgentToolHooks();

    this._buildRuntime({
      activeToolNames: this._initialActiveToolNames,
      includeAllExtensionTools: true,
    });

    // Wire context:build hook: let extensions modify messages before each LLM call
    this.agent.transformContext = async (messages, _signal) => {
      return this._extensionRunner.emitContextBuild(messages);
    };

    // Wire provider:before-request hook: wrap model with middleware
    this._wrapModelForProviderEvents();
  }

  /**
   * Wrap the agent's model with middleware that calls emitBeforeProviderRequest
   * before each provider request, allowing extensions to inspect/modify the request.
   */
  private _wrapModelForProviderEvents(): void {
    const middleware: LanguageModelMiddleware = {
      specificationVersion: "v3",
      wrapStream: async (options) => {
        const runner = this._extensionRunner;
        if (runner) {
          try {
            const modified = await runner.emitBeforeProviderRequest(options.params);
            if (modified && typeof modified === "object") {
              options = { ...options, params: modified as typeof options.params };
            }
          } catch (err) {
            runner.emitError({
              event: "provider:before-request",
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
          }
        }
        return options.doStream();
      },
    };
    this.agent.state.model = wrapLanguageModel({
      model: this.agent.state.model as LanguageModelV3,
      middleware,
    });
  }

  /**
   * Install tool hooks once on the Agent instance.
   *
   * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
   * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
   * registered tool execution to the extension context. Tool call and tool result interception now
   * happens here instead of in wrappers.
   */
  private _installAgentToolHooks(): void {
    this.agent.beforeToolCall = async ({ toolCall, args }) => {
      const runner = this._extensionRunner;
      if (!runner.hasHandlers("tool:call")) {
        return undefined;
      }

      await this._agentEventQueue;

      try {
        return await runner.emitToolCall({
          type: "tool:call",
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          input: args as Record<string, unknown>,
        });
      } catch (err) {
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(`Extension failed, blocking execution: ${String(err)}`);
      }
    };

    this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
      const runner = this._extensionRunner;
      if (!runner.hasHandlers("tool:result")) {
        return undefined;
      }

      const hookResult = await runner.emitToolResult({
        type: "tool:result",
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: args as Record<string, unknown>,
        content: result.content,
        details: result.details,
        isError,
      });

      if (!hookResult) {
        return undefined;
      }

      return {
        content: hookResult.content,
        details: hookResult.details,
        isError: hookResult.isError ?? isError,
      };
    };
  }

  // =========================================================================
  // Event Subscription
  // =========================================================================

  /** Emit an event to all listeners */
  private _emit(event: AgentSessionEvent): void {
    for (const l of this._eventListeners) {
      l(event);
    }
  }

  private _emitQueueUpdate(): void {
    this._emit({
      type: "queue_update",
      steering: [...this._steeringMessages],
      followUp: [...this._followUpMessages],
    });
  }

  // Track last assistant message for auto-compaction check
  private _lastAssistantMessage: AssistantMessage | undefined = undefined;

  /** Internal handler for agent events - shared by subscribe and reconnect */
  private _handleAgentEvent = (event: AgentEvent): void => {
    // Create retry promise synchronously before queueing async processing.
    // Agent.emit() calls this handler synchronously, and prompt() calls waitForRetry()
    // as soon as agent.prompt() resolves. If _retryPromise is created only inside
    // _processAgentEvent, slow earlier queued events can delay agent_end processing
    // and waitForRetry() can miss the in-flight retry.
    this._createRetryPromiseForAgentEnd(event);

    this._agentEventQueue = this._agentEventQueue.then(
      () => this._processAgentEvent(event),
      () => this._processAgentEvent(event),
    );

    // Keep queue alive if an event handler fails
    this._agentEventQueue.catch(() => {});
  };

  private _createRetryPromiseForAgentEnd(event: AgentEvent): void {
    if (event.type !== "agent_end" || this._retryPromise) {
      return;
    }

    if (!this._retrySettings.enabled) {
      return;
    }

    const lastAssistant = this._findLastAssistantInMessages(event.messages);
    if (!lastAssistant || !this._isRetryableError(lastAssistant)) {
      return;
    }

    this._retryPromise = new Promise((resolve) => {
      this._retryResolve = resolve;
    });
  }

  private _findLastAssistantInMessages(messages: AgentMessage[]): AssistantMessage | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === "assistant") {
        return message as AssistantMessage;
      }
    }
    return undefined;
  }

  private async _processAgentEvent(event: AgentEvent): Promise<void> {
    // When a user message starts, check if it's from either queue and remove it BEFORE emitting
    // This ensures the UI sees the updated queue state
    if (event.type === "message_start" && event.message.role === "user") {
      this._overflowRecoveryAttempted = false;
      this._contextWindowCheckDone = false;
      const messageText = this._getUserMessageText(event.message);
      if (messageText) {
        // Check steering queue first
        const steeringIndex = this._steeringMessages.indexOf(messageText);
        if (steeringIndex !== -1) {
          this._steeringMessages.splice(steeringIndex, 1);
          this._emitQueueUpdate();
        } else {
          // Check follow-up queue
          const followUpIndex = this._followUpMessages.indexOf(messageText);
          if (followUpIndex !== -1) {
            this._followUpMessages.splice(followUpIndex, 1);
            this._emitQueueUpdate();
          }
        }
      }
    }

    // Emit to extensions first
    await this._emitExtensionEvent(event);

    // Notify all listeners
    this._emit(event);

    // Handle session persistence
    if (event.type === "message_end") {
      // Check if this is a custom message from extensions
      if (event.message.role === "custom") {
        // Persist as CustomMessageEntry
        this.sessionManager.appendCustomMessageEntry(
          event.message.customType,
          event.message.content,
          event.message.display,
          event.message.details,
        );
      } else if (
        event.message.role === "user" ||
        event.message.role === "assistant" ||
        event.message.role === "tool"
      ) {
        // Regular LLM message - persist as SessionMessageEntry
        this.sessionManager.appendMessage(event.message);
      }
      // Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

      // Track assistant message for auto-compaction (checked on agent_end)
      if (event.message.role === "assistant") {
        this._lastAssistantMessage = event.message;

        const assistantMsg = event.message as AssistantMessage;
        if (assistantMsg.finishReason !== "error") {
          this._overflowRecoveryAttempted = false;
        }

        // Reset retry counter immediately on successful assistant response
        // This prevents accumulation across multiple LLM calls within a turn
        if (assistantMsg.finishReason !== "error" && this._retryAttempt > 0) {
          this._emit({
            type: "auto_retry_end",
            success: true,
            attempt: this._retryAttempt,
          });
          this._retryAttempt = 0;
        }
      }
    }

    // Check auto-retry and auto-compaction after agent completes
    if (event.type === "agent_end" && this._lastAssistantMessage) {
      this._contextWindowCheckDone = false;
      const msg = this._lastAssistantMessage;
      this._lastAssistantMessage = undefined;

      // Check for retryable errors first (overloaded, rate limit, server errors)
      if (this._isRetryableError(msg)) {
        const didRetry = await this._handleRetryableError(msg);
        if (didRetry) return; // Retry was initiated, don't proceed to compaction
      }

      this._resolveRetry();
      await this._checkCompaction(msg);
    }
  }

  /** Resolve the pending retry promise */
  private _resolveRetry(): void {
    if (this._retryResolve) {
      this._retryResolve();
      this._retryResolve = undefined;
      this._retryPromise = undefined;
    }
  }

  /** Extract text content from a message */
  private _getUserMessageText(message: Message): string {
    if (message.role !== "user") return "";
    const content = message.content;
    if (typeof content === "string") return content;
    const textBlocks = content.filter((c) => c.type === "text");
    return textBlocks.map((c) => (c as TextPart).text).join("");
  }

  /** Find the last assistant message in agent state (including aborted ones) */
  private _findLastAssistantMessage(): AssistantMessage | undefined {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        return msg as AssistantMessage;
      }
    }
    return undefined;
  }

  /** Emit extension events based on agent events */
  private async _emitExtensionEvent(event: AgentEvent): Promise<void> {
    if (event.type === "agent_start") {
      this._turnIndex = 0;
      await this._extensionRunner.emit({ type: "agent:start" });
    } else if (event.type === "agent_end") {
      await this._extensionRunner.emit({ type: "agent:end", messages: event.messages });
    } else if (event.type === "turn_start") {
      const extensionEvent: TurnStartEvent = {
        type: "turn:start",
        turnIndex: this._turnIndex,
        timestamp: Date.now(),
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "turn_end") {
      const extensionEvent: TurnEndEvent = {
        type: "turn:end",
        turnIndex: this._turnIndex,
        message: event.message,
        toolResults: event.toolResults,
      };
      await this._extensionRunner.emit(extensionEvent);
      this._turnIndex++;
    } else if (event.type === "message_start") {
      const extensionEvent: MessageStartEvent = {
        type: "message:start",
        message: event.message,
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "message_update") {
      const extensionEvent: MessageUpdateEvent = {
        type: "message:update",
        message: event.message,
        assistantMessageEvent: event.assistantMessageEvent,
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "message_end") {
      const extensionEvent: MessageEndEvent = {
        type: "message:end",
        message: event.message,
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "tool_execution_start") {
      const extensionEvent: ToolExecutionStartEvent = {
        type: "tool:execution:start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
      await this._extensionRunner.emit(extensionEvent);
    } else if (event.type === "tool_execution_end") {
      const extensionEvent: ToolExecutionEndEvent = {
        type: "tool:execution:end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
      await this._extensionRunner.emit(extensionEvent);
    }
  }

  /**
   * Subscribe to agent events.
   * Session persistence is handled internally (saves messages on message_end).
   * Multiple listeners can be added. Returns unsubscribe function for this listener.
   */
  subscribe(listener: AgentSessionEventListener): () => void {
    this._eventListeners.push(listener);

    // Return unsubscribe function for this specific listener
    return () => {
      const index = this._eventListeners.indexOf(listener);
      if (index !== -1) {
        this._eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Temporarily disconnect from agent events.
   * User listeners are preserved and will receive events again after resubscribe().
   * Used internally during operations that need to pause event processing.
   */
  private _disconnectFromAgent(): void {
    if (this._unsubscribeAgent) {
      this._unsubscribeAgent();
      this._unsubscribeAgent = undefined;
    }
  }

  /**
   * Reconnect to agent events after _disconnectFromAgent().
   * Preserves all existing listeners.
   */
  private _reconnectToAgent(): void {
    if (this._unsubscribeAgent) return; // Already connected
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
  }

  /**
   * Remove all listeners and disconnect from agent.
   * Call this when completely done with the session.
   */
  dispose(): void {
    for (const binding of this._extensionRunner.getBindings()) {
      try {
        const result = binding.cleanup?.dispose?.();
        if (result && typeof result === "object" && "then" in result) {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // ignore cleanup errors
      }
    }
    this._extensionRunner.invalidate(
      "This extension instance is stale after session replacement or reload. Use the provided replacement-session context instead.",
    );
    this._disconnectFromAgent();
    this._eventListeners = [];
  }

  // =========================================================================
  // Read-only State Access
  // =========================================================================

  /** Full agent state */
  get state(): AgentState {
    return this.agent.state;
  }

  /** Current model (may be undefined if not yet selected) */
  get model(): LanguageModel {
    return this.agent.state.model;
  }

  /** Whether agent is currently streaming a response */
  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /** Current effective system prompt (includes any per-turn extension modifications) */
  get systemPrompt(): string {
    return this.agent.state.systemPrompt;
  }

  /** Current retry attempt (0 if not retrying) */
  get retryAttempt(): number {
    return this._retryAttempt;
  }

  /**
   * Get the names of currently active tools.
   * Returns the names of tools currently set on the agent.
   */
  getActiveToolNames(): string[] {
    return Object.keys(this.agent.state.tools);
  }

  /**
   * Get all configured tools with name, description, parameter schema, and source metadata.
   */
  getAllTools(): Map<string, ToolDefinition> {
    return new Map(this._toolDefinitions);
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this._toolDefinitions.get(name);
  }

  /**
   * Set active tools by name.
   * Only tools in the registry can be enabled. Unknown tool names are ignored.
   * Changes take effect on the next agent turn.
   */
  setActiveToolsByName(toolNames: string[]): void {
    const tools: Record<string, AgentTool> = {};
    for (const name of toolNames) {
      const tool = this._toolRegistry.get(name);
      if (tool) {
        tools[name] = tool;
      }
    }
    this.agent.state.tools = tools;
  }

  /** Whether compaction or branch summarization is currently running */
  get isCompacting(): boolean {
    return (
      this._autoCompactionAbortController !== undefined ||
      this._compactionAbortController !== undefined ||
      this._branchSummaryAbortController !== undefined
    );
  }

  /** All messages including custom types like BashExecutionMessage */
  get messages(): AgentMessage[] {
    return this.agent.state.messages;
  }

  /** Current steering mode */
  get steeringMode(): "all" | "one-at-a-time" {
    return this.agent.steeringMode;
  }

  /** Current follow-up mode */
  get followUpMode(): "all" | "one-at-a-time" {
    return this.agent.followUpMode;
  }

  /** Settings manager for dual-scope settings */
  get settings(): SettingsManager {
    return this._settingsManager;
  }

  /** Current session file path, or undefined if sessions are disabled */
  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }

  /** Current session ID */
  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }

  /** Current session display name, if set */
  get sessionName(): string | undefined {
    return this.sessionManager.getSessionName();
  }

  /** Set the display name for the current session */
  set sessionName(name: string) {
    this.sessionManager.appendSessionInfo(name);
  }

  /** Update the context window used for compaction checks. */
  setContextWindow(value: number, scope: "global" | "local" = "local"): void {
    this._contextWindow = value;
    this._settingsManager.setContextWindow(value, scope);
  }

  /** Update the compaction reserve token threshold. */
  setCompactionReserveTokens(tokens: number, scope: "global" | "local" = "local"): void {
    this._compactionSettings = { ...this._compactionSettings, reserveTokens: tokens };
    this._settingsManager.setCompactionReserveTokens(tokens, scope);
  }

  /** Update the compaction keep-recent token threshold. */
  setCompactionKeepRecentTokens(tokens: number, scope: "global" | "local" = "local"): void {
    this._compactionSettings = { ...this._compactionSettings, keepRecentTokens: tokens };
    this._settingsManager.setCompactionKeepRecentTokens(tokens, scope);
  }

  /** Update the retry attempt limit. */
  setRetryMaxRetries(maxRetries: number, scope: "global" | "local" = "local"): void {
    this._retrySettings = { ...this._retrySettings, maxRetries };
    this._settingsManager.setRetryMaxRetries(maxRetries, scope);
  }

  /** Update the retry base delay. */
  setRetryBaseDelayMs(delayMs: number, scope: "global" | "local" = "local"): void {
    this._retrySettings = { ...this._retrySettings, baseDelayMs: delayMs };
    this._settingsManager.setRetryBaseDelayMs(delayMs, scope);
  }

  /** Update the retry max delay. */
  setRetryMaxDelayMs(delayMs: number, scope: "global" | "local" = "local"): void {
    this._retrySettings = { ...this._retrySettings, maxDelayMs: delayMs };
    this._settingsManager.setRetryMaxDelayMs(delayMs, scope);
  }

  private _normalizePromptSnippet(text: string | undefined): string | undefined {
    if (!text) return undefined;
    const oneLine = text
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return oneLine.length > 0 ? oneLine : undefined;
  }

  private _normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
    if (!guidelines || guidelines.length === 0) {
      return [];
    }

    const unique = new Set<string>();
    for (const guideline of guidelines) {
      const normalized = guideline.trim();
      if (normalized.length > 0) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  }

  private _collectToolPromptContext(): BuildSystemPromptOptions {
    const activeToolNames = Object.keys(this.agent.state.tools);
    const toolSnippets: Record<string, string> = {};
    const promptGuidelines: string[] = [];

    for (const name of activeToolNames) {
      const snippet = this._toolPromptSnippets.get(name);
      if (snippet) {
        toolSnippets[name] = snippet;
      }
      const guidelines = this._toolPromptGuidelines.get(name);
      if (guidelines) {
        promptGuidelines.push(...guidelines);
      }
    }

    return {
      cwd: this._cwd,
      baseSystemPrompt: this.agent.state.systemPrompt,
      selectedTools: activeToolNames,
      toolSnippets,
      promptGuidelines,
    };
  }

  // =========================================================================
  // Prompting
  // =========================================================================

  /**
   * Emit agent:before-start extension event and apply the resulting
   * system prompt / injected messages. Shared by prompt() and sendCustomMessage().
   */
  private async _applyBeforeAgentStart(
    promptText: string,
    images?: ImagePart[],
  ): Promise<AgentMessage[]> {
    const toolPromptContext = this._collectToolPromptContext();

    const result = await this._extensionRunner.emitBeforeAgentStart(
      promptText,
      images,
      this.agent.state.systemPrompt,
      toolPromptContext,
    );

    const injected: AgentMessage[] =
      result?.messages?.map((msg) => ({
        role: "custom" as const,
        customType: msg.customType,
        content: msg.content,
        display: msg.display,
        details: msg.details,
        timestamp: Date.now(),
      })) ?? [];

    if (result?.systemPrompt !== undefined) {
      this.agent.state.systemPrompt = result.systemPrompt;
    }
    return injected;
  }

  /**
   * Send a prompt to the agent.
   * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
   * - Expands file-based prompt templates by default
   * - During streaming, queues via steer() or followUp() based on streamingBehavior option
   * - Validates model and API key before sending (when not streaming)
   * @throws Error if streaming and no streamingBehavior specified
   * @throws Error if no model selected or no API key available (when not streaming)
   */
  async prompt(text: string, options?: PromptOptions): Promise<void> {
    let messages: AgentMessage[] | undefined;

    const currentImages = options?.images;

    // If streaming, queue via steer() or followUp() based on option
    if (this.isStreaming) {
      if (!options?.streamingBehavior) {
        throw new Error(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        );
      }
      if (options.streamingBehavior === "followUp") {
        await this._queueFollowUp(text, currentImages);
      } else {
        await this._queueSteer(text, currentImages);
      }

      return;
    }

    // Check if context window limit is exceeded (handles restored sessions without usage data)
    await this._ensureContextWindowLimit();

    // Check if we need to compact before sending (catches aborted responses)
    const lastAssistant = this._findLastAssistantMessage();
    if (lastAssistant) {
      await this._checkCompaction(lastAssistant, false);
    }

    // Build messages array (custom message if any, then user message)
    messages = [];

    // Add user message
    const userContent: (TextPart | ImagePart)[] = [{ type: "text", text: text }];
    if (currentImages) {
      userContent.push(...currentImages);
    }
    messages.push({
      role: "user",
      content: userContent,
      timestamp: Date.now(),
    });

    // Inject any pending "nextTurn" messages as context alongside the user message
    for (const msg of this._pendingNextTurnMessages) {
      messages.push(msg);
    }
    this._pendingNextTurnMessages = [];

    // Emit before_agent_start extension event and apply system prompt
    messages.push(...(await this._applyBeforeAgentStart(text, currentImages)));

    if (!messages) {
      return;
    }

    await this.agent.prompt(messages);
    await this.waitForRetry();
  }

  /**
   * Queue a steering message while the agent is running.
   * Delivered after the current assistant turn finishes executing its tool calls,
   * before the next LLM call.
   * Expands skill commands and prompt templates. Errors on extension commands.
   * @param images Optional image attachments to include with the message
   * @throws Error if text is an extension command
   */
  async steer(text: string, images?: ImagePart[]): Promise<void> {
    await this._queueSteer(text, images);
  }

  /**
   * Queue a follow-up message to be processed after the agent finishes.
   * Delivered only when agent has no more tool calls or steering messages.
   * Expands skill commands and prompt templates. Errors on extension commands.
   * @param images Optional image attachments to include with the message
   * @throws Error if text is an extension command
   */
  async followUp(text: string, images?: ImagePart[]): Promise<void> {
    await this._queueFollowUp(text, images);
  }

  /**
   * Internal: Queue a steering message (already expanded, no extension command check).
   */
  private async _queueSteer(text: string, images?: ImagePart[]): Promise<void> {
    this._steeringMessages.push(text);
    this._emitQueueUpdate();
    const content: (TextPart | ImagePart)[] = [{ type: "text", text }];
    if (images) {
      content.push(...images);
    }
    this.agent.steer({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Internal: Queue a follow-up message (already expanded, no extension command check).
   */
  private async _queueFollowUp(text: string, images?: ImagePart[]): Promise<void> {
    this._followUpMessages.push(text);
    this._emitQueueUpdate();
    const content: (TextPart | ImagePart)[] = [{ type: "text", text }];
    if (images) {
      content.push(...images);
    }
    this.agent.followUp({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Send a custom message to the session. Creates a CustomMessageEntry.
   *
   * Handles three cases:
   * - Streaming: queues message, processed when loop pulls from queue
   * - Not streaming + triggerTurn: appends to state/session, starts new turn
   * - Not streaming + no trigger: appends to state/session, no turn
   *
   * @param message Custom message with customType, content, display, details
   * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
   * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
   */
  async sendCustomMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void> {
    const appMessage = {
      role: "custom" as const,
      customType: message.customType,
      content: message.content,
      display: message.display,
      details: message.details,
      timestamp: Date.now(),
    } satisfies CustomMessage<T>;
    if (options?.deliverAs === "nextTurn") {
      this._pendingNextTurnMessages.push(appMessage);
    } else if (this.isStreaming) {
      if (options?.deliverAs === "followUp") {
        this.agent.followUp(appMessage);
      } else {
        this.agent.steer(appMessage);
      }
    } else if (options?.triggerTurn) {
      // Apply extension before-start hooks (system prompt, injected messages)
      const promptText = typeof message.content === "string" ? message.content : "";
      const injected = await this._applyBeforeAgentStart(promptText);
      for (const msg of injected) this.agent.state.messages.push(msg);
      await this.agent.prompt(appMessage);
    } else {
      this.agent.state.messages.push(appMessage);
      this.sessionManager.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details,
      );
      this._emit({ type: "message_start", message: appMessage });
      this._emit({ type: "message_end", message: appMessage });
    }
  }

  /**
   * Send a user message to the agent. Always triggers a turn.
   * When the agent is streaming, use deliverAs to specify how to queue the message.
   *
   * @param content User message content (string or content array)
   * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
   */
  async sendUserMessage(
    content: string | (TextPart | ImagePart)[],
    options?: { deliverAs?: "steer" | "followUp" },
  ): Promise<void> {
    // Normalize content to text string + optional images
    let text: string;
    let images: ImagePart[] | undefined;

    if (typeof content === "string") {
      text = content;
    } else {
      const textParts: string[] = [];
      images = [];
      for (const part of content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else {
          images.push(part);
        }
      }
      text = textParts.join("\n");
      if (images.length === 0) images = undefined;
    }

    // Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
    await this.prompt(text, {
      streamingBehavior: options?.deliverAs,
      images,
    });
  }

  /**
   * Clear all queued messages and return them.
   * Useful for restoring to editor when user aborts.
   * @returns Object with steering and followUp arrays
   */
  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this._steeringMessages];
    const followUp = [...this._followUpMessages];
    this._steeringMessages = [];
    this._followUpMessages = [];
    this.agent.clearAllQueues();
    this._emitQueueUpdate();
    return { steering, followUp };
  }

  /** Number of pending messages (includes both steering and follow-up) */
  get pendingMessageCount(): number {
    return this._steeringMessages.length + this._followUpMessages.length;
  }

  /** Get pending steering messages (read-only) */
  getSteeringMessages(): readonly string[] {
    return this._steeringMessages;
  }

  /** Get pending follow-up messages (read-only) */
  getFollowUpMessages(): readonly string[] {
    return this._followUpMessages;
  }

  /**
   * Abort current operation and wait for agent to become idle.
   */
  async abort(): Promise<void> {
    this.abortRetry();
    this.agent.abort();
    await this.agent.waitForIdle();
  }

  // =========================================================================
  // Model Management
  // =========================================================================

  /**
   * Set model directly.
   * Validates that auth is configured, saves to session and settings.
   * @throws Error if no auth is configured for the model
   */
  async setModel(model: LanguageModel): Promise<void> {
    this.agent.state.model = model;
  }

  // =========================================================================
  // Queue Mode Management
  // =========================================================================

  /**
   * Set steering message mode.
   * Saves to settings.
   */
  setSteeringMode(mode: "all" | "one-at-a-time", scope: "global" | "local" = "local"): void {
    this.agent.steeringMode = mode;
    this._settingsManager.setSteeringMode(mode, scope);
  }

  /**
   * Set follow-up message mode.
   * Saves to settings.
   */
  setFollowUpMode(mode: "all" | "one-at-a-time", scope: "global" | "local" = "local"): void {
    this.agent.followUpMode = mode;
    this._settingsManager.setFollowUpMode(mode, scope);
  }

  // =========================================================================
  // Compaction
  // =========================================================================

  /**
   * Manually compact the session context.
   * Aborts current agent operation first.
   * @param customInstructions Optional instructions for the compaction summary
   */
  async compact(customInstructions?: string): Promise<CompactionResult> {
    this._disconnectFromAgent();
    await this.abort();
    this._compactionAbortController = new AbortController();
    this._emit({ type: "compaction_start", reason: "manual" });

    try {
      if (!this.model) {
        throw new Error("No model selected");
      }

      const pathEntries = this.sessionManager.getBranch();
      const settings = this._compactionSettings;

      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        // Check why we can't compact
        const lastEntry = pathEntries[pathEntries.length - 1];
        if (lastEntry?.type === "compaction") {
          throw new Error("Already compacted");
        }
        throw new Error("Nothing to compact (session too small)");
      }

      let extensionCompaction: CompactionResult | undefined;
      let fromExtension = false;

      if (this._extensionRunner.hasHandlers("session:before-compact")) {
        const result = (await this._extensionRunner.emit({
          type: "session:before-compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions,
          signal: this._compactionAbortController.signal,
        })) as SessionBeforeCompactResult | undefined;

        if (result?.cancel) {
          throw new Error("Compaction cancelled");
        }

        if (result?.compaction) {
          extensionCompaction = result.compaction;
          fromExtension = true;
        }
      }

      let summary: string;
      let firstKeptEntryId: string;
      let tokensBefore: number;
      let details: unknown;

      if (extensionCompaction) {
        // Extension provided compaction content
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        details = extensionCompaction.details;
      } else {
        // Generate compaction result
        const result = await compact(
          preparation,
          this.model,
          {},
          customInstructions,
          this._compactionAbortController.signal,
          this._compactionPrompts,
        );
        summary = result.summary;
        firstKeptEntryId = result.firstKeptEntryId;
        tokensBefore = result.tokensBefore;
        details = result.details;
      }

      if (this._compactionAbortController.signal.aborted) {
        throw new Error("Compaction cancelled");
      }

      this.sessionManager.appendCompaction(
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
        fromExtension,
      );
      const newEntries = this.sessionManager.getEntries();
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;

      // Get the saved compaction entry for the extension event
      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as CompactionEntry | undefined;

      if (this._extensionRunner && savedCompactionEntry) {
        await this._extensionRunner.emit({
          type: "session:compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
        });
      }

      const compactionResult = {
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
      };
      this._emit({
        type: "compaction_end",
        reason: "manual",
        result: compactionResult,
        aborted: false,
        willRetry: false,
      });
      return compactionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted =
        message === "Compaction cancelled" ||
        (error instanceof Error && error.name === "AbortError");
      this._emit({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted,
        willRetry: false,
        errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
      });
      throw error;
    } finally {
      this._compactionAbortController = undefined;
      this._reconnectToAgent();
    }
  }

  /**
   * Cancel in-progress compaction (manual or auto).
   */
  abortCompaction(): void {
    this._compactionAbortController?.abort();
    this._autoCompactionAbortController?.abort();
  }

  /**
   * Cancel in-progress branch summarization.
   */
  abortBranchSummary(): void {
    this._branchSummaryAbortController?.abort();
  }

  /**
   * Ensure the current context does not exceed the context window limit.
   * Uses estimateContextTokens (works without assistant usage data) so restored
   * messages are correctly sized. Runs at most once per prompt cycle via
   * `_contextWindowCheckDone` to avoid infinite compaction loops.
   */
  private async _ensureContextWindowLimit(): Promise<void> {
    if (this._contextWindowCheckDone) return;
    this._contextWindowCheckDone = true;

    if (!this._compactionSettings.enabled) return;

    const estimate = estimateContextTokens(this.agent.state.messages);
    if (shouldCompact(estimate.tokens, this._contextWindow, this._compactionSettings)) {
      if (!this.model) {
        // No model available — cannot compact, log and degrade gracefully
        return;
      }
      await this._runAutoCompaction("threshold", false);
    }
  }

  /**
   * Check if compaction is needed and run it.
   * Called after agent_end and before prompt submission.
   *
   * Two cases:
   * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
   * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
   *
   * @param assistantMessage The assistant message to check
   * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
   */
  private async _checkCompaction(
    assistantMessage: AssistantMessage,
    skipAbortedCheck = true,
  ): Promise<void> {
    const settings = this._compactionSettings;
    if (!settings.enabled) return;

    // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
    if (skipAbortedCheck && assistantMessage.finishReason === "abort") return;

    const contextWindow = this._contextWindow;

    // Skip compaction checks if this assistant message is older than the latest
    // compaction boundary. This prevents a stale pre-compaction usage/error
    // from retriggering compaction on the first prompt after compaction.
    const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
    const assistantIsFromBeforeCompaction =
      compactionEntry !== null &&
      assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
    if (assistantIsFromBeforeCompaction) {
      return;
    }

    // Case 1: Overflow - LLM returned context overflow error
    // if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
    //   if (this._overflowRecoveryAttempted) {
    //     this._emit({
    //       type: "compaction_end",
    //       reason: "overflow",
    //       result: undefined,
    //       aborted: false,
    //       willRetry: false,
    //       errorMessage:
    //         "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
    //     });
    //     return;
    //   }

    //   this._overflowRecoveryAttempted = true;
    //   // Remove the error message from agent state (it IS saved to session for history,
    //   // but we don't want it in context for the retry)
    //   const messages = this.agent.state.messages;
    //   if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    //     this.agent.state.messages = messages.slice(0, -1);
    //   }
    //   await this._runAutoCompaction("overflow", true);
    //   return;
    // }

    // Case 2: Threshold - context is getting large
    // For error messages (no usage data), estimate from last successful response.
    // This ensures sessions that hit persistent API errors (e.g. 529) can still compact.
    let contextTokens: number;
    if (assistantMessage.finishReason === "error") {
      const messages = this.agent.state.messages;
      const estimate = estimateContextTokens(messages);
      if (estimate.lastUsageIndex === null) return; // No usage data at all
      // Verify the usage source is post-compaction. Kept pre-compaction messages
      // have stale usage reflecting the old (larger) context and would falsely
      // trigger compaction right after one just finished.
      const usageMsg = messages[estimate.lastUsageIndex];
      if (
        compactionEntry &&
        usageMsg.role === "assistant" &&
        (usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()
      ) {
        return;
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = calculateContextTokens(assistantMessage.usage);
    }
    if (shouldCompact(contextTokens, contextWindow, settings)) {
      await this._runAutoCompaction("threshold", false);
    }
  }

  /**
   * Internal: Run auto-compaction with events.
   */
  private async _runAutoCompaction(
    reason: "overflow" | "threshold",
    willRetry: boolean,
  ): Promise<void> {
    const settings = this._compactionSettings;

    this._emit({ type: "compaction_start", reason });
    this._autoCompactionAbortController = new AbortController();

    try {
      if (!this.model) {
        this._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: false,
          willRetry: false,
        });
        return;
      }

      const pathEntries = this.sessionManager.getBranch();

      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        this._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: false,
          willRetry: false,
        });
        return;
      }

      let extensionCompaction: CompactionResult | undefined;
      let fromExtension = false;

      if (this._extensionRunner.hasHandlers("session:before-compact")) {
        const extensionResult = (await this._extensionRunner.emit({
          type: "session:before-compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions: undefined,
          signal: this._autoCompactionAbortController.signal,
        })) as SessionBeforeCompactResult | undefined;

        if (extensionResult?.cancel) {
          this._emit({
            type: "compaction_end",
            reason,
            result: undefined,
            aborted: true,
            willRetry: false,
          });
          return;
        }

        if (extensionResult?.compaction) {
          extensionCompaction = extensionResult.compaction;
          fromExtension = true;
        }
      }

      let summary: string;
      let firstKeptEntryId: string;
      let tokensBefore: number;
      let details: unknown;

      if (extensionCompaction) {
        // Extension provided compaction content
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        details = extensionCompaction.details;
      } else {
        // Generate compaction result
        const compactResult = await compact(
          preparation,
          this.model,
          {},
          undefined,
          this._autoCompactionAbortController.signal,
          this._compactionPrompts,
        );
        summary = compactResult.summary;
        firstKeptEntryId = compactResult.firstKeptEntryId;
        tokensBefore = compactResult.tokensBefore;
        details = compactResult.details;
      }

      if (this._autoCompactionAbortController.signal.aborted) {
        this._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: true,
          willRetry: false,
        });
        return;
      }

      this.sessionManager.appendCompaction(
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
        fromExtension,
      );
      const newEntries = this.sessionManager.getEntries();
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;

      // Get the saved compaction entry for the extension event
      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as CompactionEntry | undefined;

      if (this._extensionRunner && savedCompactionEntry) {
        await this._extensionRunner.emit({
          type: "session:compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
        });
      }

      const result: CompactionResult = {
        summary,
        firstKeptEntryId,
        tokensBefore,
        details,
      };
      this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

      if (willRetry) {
        const messages = this.agent.state.messages;
        const lastMsg = messages[messages.length - 1];
        if (
          lastMsg?.role === "assistant" &&
          (lastMsg as AssistantMessage).finishReason === "error"
        ) {
          this.agent.state.messages = messages.slice(0, -1);
        }

        setTimeout(() => {
          this.agent.continue().catch(() => {});
        }, 100);
      } else if (this.agent.hasQueuedMessages()) {
        // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
        // Kick the loop so queued messages are actually delivered.
        setTimeout(() => {
          this.agent.continue().catch(() => {});
        }, 100);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "compaction failed";
      this._emit({
        type: "compaction_end",
        reason,
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage:
          reason === "overflow"
            ? `Context overflow recovery failed: ${errorMessage}`
            : `Auto-compaction failed: ${errorMessage}`,
      });
    } finally {
      this._autoCompactionAbortController = undefined;
    }
  }

  /**
   * Toggle auto-compaction setting.
   */
  setAutoCompactionEnabled(enabled: boolean, scope: "global" | "local" = "local"): void {
    this._compactionSettings.enabled = enabled;
    this._settingsManager.setCompactionEnabled(enabled, scope);
  }

  /** Whether auto-compaction is enabled */
  get autoCompactionEnabled(): boolean {
    return this._compactionSettings.enabled;
  }

  async bindExtensions(bindings: ExtensionBindings): Promise<void> {
    if (bindings.onError !== undefined) {
      this._extensionErrorListener = bindings.onError;
    }

    this._applyExtensionBindings(this._extensionRunner);
    await this._extensionRunner.emit(this._sessionStartEvent);
  }

  private _applyExtensionBindings(runner: ExtensionRunner): void {
    this._extensionErrorUnsubscriber?.();
    this._extensionErrorUnsubscriber = this._extensionErrorListener
      ? runner.onError(this._extensionErrorListener)
      : undefined;
  }

  private _bindExtensionCore(runner: ExtensionRunner): void {
    runner.bindCore(
      {
        sendMessage: (message, options) => {
          this.sendCustomMessage(message, options).catch((err) => {
            runner.emitError({
              event: "send_message",
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
        sendUserMessage: (content, options) => {
          this.sendUserMessage(content, options).catch((err) => {
            runner.emitError({
              event: "send_user_message",
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
        appendEntry: (customType, data) => {
          this.sessionManager.appendCustomEntry(customType, data);
        },
        setSessionName: (name) => {
          this.sessionManager.appendSessionInfo(name);
        },
        getSessionName: () => {
          return this.sessionManager.getSessionName();
        },

        getActiveTools: () => this.getActiveToolNames(),
        setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
        refreshTools: () => this._refreshToolRegistry({ fromRegisterTool: true }),
      },
      {
        getModel: () => this.model,
        isIdle: () => !this.isStreaming,
        getSignal: () => this.agent.signal,
        abort: () => this.abort(),
        hasPendingMessages: () => this.pendingMessageCount > 0,
        shutdown: () => {},
        getContextUsage: () => this.getContextUsage(),
        compact: (options) => {
          void (async () => {
            try {
              const result = await this.compact(options?.customInstructions);
              options?.onComplete?.(result);
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              options?.onError?.(err);
            }
          })();
        },
        getSystemPrompt: () => this.systemPrompt,
      },
    );
  }

  private _refreshToolRegistry(options?: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean;
    fromRegisterTool?: boolean;
  }): void {
    const previousActiveToolNames = this.getActiveToolNames();
    const allowedToolNames = this._allowedToolNames;
    const isAllowedTool = (name: string): boolean =>
      !allowedToolNames || allowedToolNames.has(name);

    // 收集所有 extension tools
    const extensionTools = new Map<string, ToolDefinition>();
    for (const binding of this._extensionRunner.getBindings()) {
      for (const [name, tool] of binding.tools) {
        if (isAllowedTool(name) && !extensionTools.has(name)) {
          extensionTools.set(name, tool);
        }
      }
    }

    // 合并 base tools + extension tools + custom tools
    const toolRegistry = new Map<string, AgentTool>();
    const definitionRegistry = new Map<string, ToolDefinition>();

    // base tools
    for (const [name, tool] of this._baseToolDefinitions) {
      if (isAllowedTool(name)) {
        toolRegistry.set(name, tool);
        definitionRegistry.set(name, tool);
      }
    }

    // extension tools
    for (const [name, tool] of extensionTools) {
      toolRegistry.set(name, tool);
      definitionRegistry.set(name, tool);
    }

    // custom tools
    for (const [name, tool] of this._customTools) {
      if (isAllowedTool(name)) {
        toolRegistry.set(name, tool);
        definitionRegistry.set(name, tool);
      }
    }

    this._toolRegistry = toolRegistry;

    this._toolPromptSnippets = new Map(
      Array.from(definitionRegistry.values())
        .map((definition) => {
          const snippet = this._normalizePromptSnippet(definition.promptSnippet);
          return snippet ? ([definition.name, snippet] as const) : undefined;
        })
        .filter((entry): entry is readonly [string, string] => entry !== undefined),
    );

    this._toolPromptGuidelines = new Map(
      Array.from(definitionRegistry.values())
        .map((definition) => {
          const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
          return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
        })
        .filter((entry): entry is readonly [string, string[]] => entry !== undefined),
    );

    // 计算 active tools
    const nextActiveToolNames = (options?.activeToolNames ?? previousActiveToolNames).filter(
      (name) => isAllowedTool(name),
    );

    if (options?.fromRegisterTool || options?.includeAllExtensionTools) {
      for (const name of extensionTools.keys()) {
        if (!nextActiveToolNames.includes(name)) {
          nextActiveToolNames.push(name);
        }
      }
    }

    this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
  }

  private _buildRuntime(options: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean;
    extensions?: ExtensionDefinition[];
  }): void {
    const runtime = createExtensionRuntime();
    const definitions = options.extensions ?? this._extensions ?? [];
    const eventBus = createEventBus();

    this._extensionRunner = new ExtensionRunner(
      [],
      runtime,
      this._cwd,
      this.sessionManager,
      eventBus,
    );
    if (this._extensionRunnerRef) {
      this._extensionRunnerRef.current = this._extensionRunner;
    }
    this._bindExtensionCore(this._extensionRunner);
    this._applyExtensionBindings(this._extensionRunner);

    // 同步创建初始 bindings（setup 可能返回 Promise，在后台执行）
    this._extensionRunner.reloadSync(definitions);

    const defaultActiveToolNames = this._baseToolsOverride
      ? Object.keys(this._baseToolsOverride)
      : ["read", "bash", "edit", "write"];
    const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
    this._refreshToolRegistry({
      activeToolNames: baseActiveToolNames,
      includeAllExtensionTools: options.includeAllExtensionTools,
    });
  }

  async reload(extensions?: ExtensionDefinition[]): Promise<void> {
    await emitSessionShutdownEvent(this._extensionRunner, {
      type: "session:shutdown",
      reason: "reload",
    });

    // 异步 reload：await 旧 cleanup + 新 setup
    await this._extensionRunner.reload(extensions ?? this._extensions ?? []);

    this._refreshToolRegistry({
      activeToolNames: this.getActiveToolNames(),
      includeAllExtensionTools: true,
    });

    const hasBindings = this._extensionErrorListener;
    if (hasBindings) {
      await this._extensionRunner.emit({ type: "session:start", reason: "reload" });
    }
  }

  // =========================================================================
  // Auto-Retry
  // =========================================================================

  /**
   * Check if an error is retryable (overloaded, rate limit, server errors).
   * Context overflow errors are NOT retryable (handled by compaction instead).
   */
  private _isRetryableError(message: AssistantMessage): boolean {
    if (message.finishReason !== "error" || !message.errorMessage) return false;

    const err = message.errorMessage;
    // Match: overloaded_error, provider returned error, rate limit, 429, 500, 502, 503, 504, service unavailable, network/connection errors (including connection lost), fetch failed, request ended without sending chunks, terminated, retry delay exceeded
    return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|timed? out|timeout|terminated|retry delay/i.test(
      err,
    );
  }

  /**
   * Handle retryable errors with exponential backoff.
   * @returns true if retry was initiated, false if max retries exceeded or disabled
   */
  private async _handleRetryableError(message: AssistantMessage): Promise<boolean> {
    const settings = this._retrySettings;
    if (!settings.enabled) {
      this._resolveRetry();
      return false;
    }

    // Retry promise is created synchronously in _handleAgentEvent for agent_end.
    // Keep a defensive fallback here in case a future refactor bypasses that path.
    if (!this._retryPromise) {
      this._retryPromise = new Promise((resolve) => {
        this._retryResolve = resolve;
      });
    }

    this._retryAttempt++;

    if (this._retryAttempt > settings.maxRetries) {
      // Max retries exceeded, emit final failure and reset
      this._emit({
        type: "auto_retry_end",
        success: false,
        attempt: this._retryAttempt - 1,
        finalError: message.errorMessage,
      });
      this._retryAttempt = 0;
      this._resolveRetry(); // Resolve so waitForRetry() completes
      return false;
    }

    const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

    this._emit({
      type: "auto_retry_start",
      attempt: this._retryAttempt,
      maxAttempts: settings.maxRetries,
      delayMs,
      errorMessage: message.errorMessage || "Unknown error",
    });

    // Remove error message from agent state (keep in session for history)
    const messages = this.agent.state.messages;
    if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
      this.agent.state.messages = messages.slice(0, -1);
    }

    // Wait with exponential backoff (abortable)
    this._retryAbortController = new AbortController();
    try {
      const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, ms);
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Sleep aborted"));
          });
        });
      await sleep(delayMs, this._retryAbortController.signal);
    } catch {
      // Aborted during sleep - emit end event so UI can clean up
      const attempt = this._retryAttempt;
      this._retryAttempt = 0;
      this._retryAbortController = undefined;
      this._emit({
        type: "auto_retry_end",
        success: false,
        attempt,
        finalError: "Retry cancelled",
      });
      this._resolveRetry();
      return false;
    }
    this._retryAbortController = undefined;

    // Retry via continue() - use setTimeout to break out of event handler chain
    setTimeout(() => {
      this.agent.continue().catch(() => {
        // Retry failed - will be caught by next agent_end
      });
    }, 0);

    return true;
  }

  /**
   * Cancel in-progress retry.
   */
  abortRetry(): void {
    this._retryAbortController?.abort();
    // Note: _retryAttempt is reset in the catch block of _autoRetry
    this._resolveRetry();
  }

  /**
   * Wait for any in-progress retry to complete.
   * Returns immediately if no retry is in progress.
   */
  private async waitForRetry(): Promise<void> {
    if (!this._retryPromise) {
      return;
    }

    await this._retryPromise;
    await this.agent.waitForIdle();
  }

  /** Whether auto-retry is currently in progress */
  get isRetrying(): boolean {
    return this._retryPromise !== undefined;
  }

  /** Whether auto-retry is enabled */
  get autoRetryEnabled(): boolean {
    return this._retrySettings.enabled;
  }

  /**
   * Toggle auto-retry setting.
   */
  setAutoRetryEnabled(enabled: boolean, scope: "global" | "local" = "local"): void {
    this._retrySettings = { ...this._retrySettings, enabled };
    this._settingsManager.setRetryEnabled(enabled, scope);
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  getContextUsage(): ContextUsage | undefined {
    const model = this.model;
    if (!model) return undefined;

    const contextWindow = this._contextWindow;
    if (contextWindow <= 0) return undefined;

    // After compaction, the last assistant usage reflects pre-compaction context size.
    // We can only trust usage from an assistant that responded after the latest compaction.
    // If no such assistant exists, context token count is unknown until the next LLM response.
    const branchEntries = this.sessionManager.getBranch();
    const latestCompaction = getLatestCompactionEntry(branchEntries);

    if (latestCompaction) {
      // Check if there's a valid assistant usage after the compaction boundary
      const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
      let hasPostCompactionUsage = false;
      for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
        const entry = branchEntries[i];
        if (entry.type === "message" && entry.message.role === "assistant") {
          const assistant = entry.message;
          if (assistant.finishReason !== "abort" && assistant.finishReason !== "error") {
            const contextTokens = calculateContextTokens(assistant.usage);
            if (contextTokens > 0) {
              hasPostCompactionUsage = true;
            }
            break;
          }
        }
      }

      if (!hasPostCompactionUsage) {
        return { tokens: null, contextWindow, percent: null };
      }
    }

    const estimate = estimateContextTokens(this.messages);
    const percent = (estimate.tokens / contextWindow) * 100;

    return {
      tokens: estimate.tokens,
      contextWindow,
      percent,
    };
  }

  /**
   * Export the current session branch to a JSONL file.
   * Writes the session header followed by all entries on the current branch path.
   * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
   * @returns The resolved output file path.
   */
  exportToJsonl(outputPath?: string): string {
    const filePath = resolve(
      outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
    );
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const header: SessionHeader = {
      type: "session",
      id: this.sessionManager.getSessionId(),
      timestamp: new Date().toISOString(),
      cwd: this.sessionManager.getCwd(),
    };

    const branchEntries = this.sessionManager.getBranch();
    const lines = [JSON.stringify(header)];

    // Re-chain parentIds to form a linear sequence
    let prevId: string | null = null;
    for (const entry of branchEntries) {
      const linear = { ...entry, parentId: prevId };
      lines.push(JSON.stringify(linear));
      prevId = entry.id;
    }

    writeFileSync(filePath, `${lines.join("\n")}\n`);
    return filePath;
  }

  // =========================================================================
  // Extension System
  // =========================================================================

  /**
   * Check if extensions have handlers for a specific event type.
   */
  hasExtensionHandlers(eventType: string): boolean {
    return this._extensionRunner.hasHandlers(eventType);
  }

  /**
   * Get the extension runner (for setting UI context and error handlers).
   */
  get extensionRunner(): ExtensionRunner {
    return this._extensionRunner;
  }
}
