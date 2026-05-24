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
  type CompactionPrompts,
  type CompactionResult,
  CompactionSettings,
  DEFAULT_COMPACTION_PROMPTS,
  estimateContextTokens,
  shouldCompact,
} from "./compaction/index.js";
import { Compactor } from "./compactor.js";
import {
  type BuildSystemPromptOptions,
  type ContextUsage,
  type HookRunner,
} from "./hook-runner.js";
import type { CustomMessage } from "./messages.js";
import { RetryHandler, type RetrySettings } from "./retry-handler.js";
import type { SessionManager } from "./session-manager.js";
import { getLatestCompactionEntry, type SessionHeader } from "./session-manager.js";

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
 * Extension Tool Snapshot — full set of extension tools for a channel.
 * Applied atomically to AgentSession via applyToolState().
 */
export interface ExtensionToolSnapshot {
  tools: Map<string, AgentTool>;
  activeToolNames?: string[];
}

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  hookRunner: HookRunner;
  /** Context window size in tokens */
  contextWindow?: number;
  /** Compaction behavior settings */
  compactionSettings?: Partial<CompactionSettings>;
  /** Customizable compaction prompts. Overrides defaults. */
  compactionPrompts?: CompactionPrompts;
  /** Auto-retry behavior settings */
  retrySettings?: Partial<RetrySettings>;
  /** Steering message queue mode */
  steeringMode?: "all" | "one-at-a-time";
  /** Follow-up message queue mode */
  followUpMode?: "all" | "one-at-a-time";
  /** SDK custom tools registered outside extensions */
  customTools?: Map<string, AgentTool>;
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

  // HookRunner (pure hook dispatcher, provided by core)
  private _hookRunner: HookRunner;

  // Compactor (extracted compaction logic)
  private _compactor: Compactor;

  // RetryHandler (extracted retry logic)
  private _retryHandler: RetryHandler;

  // Tool state
  private _customTools: Map<string, AgentTool>;
  private _baseToolDefinitions: Map<string, AgentTool> = new Map();
  private _extensionTools: Map<string, AgentTool> = new Map();
  private _initialActiveToolNames?: string[];
  private _allowedToolNames?: Set<string>;
  private _baseToolsOverride?: Map<string, AgentTool>;

  private _turnIndex = 0;

  // Tool registry for extension getTools/setTools
  private _toolRegistry: Map<string, AgentTool> = new Map();

  private _compactionSettings: CompactionSettings;
  private _compactionPrompts: CompactionPrompts;
  private _contextWindow: number;

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this._hookRunner = config.hookRunner;
    this._customTools = config.customTools ?? new Map();
    this._initialActiveToolNames = config.initialActiveToolNames;
    this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
    this._baseToolsOverride = config.baseToolsOverride;

    // Read settings from plain config fields
    this._contextWindow = config.contextWindow ?? 128000;
    this._compactionSettings = {
      enabled: config.compactionSettings?.enabled ?? true,
      reserveTokens: config.compactionSettings?.reserveTokens ?? 16384,
      keepRecentTokens: config.compactionSettings?.keepRecentTokens ?? 20000,
    };
    // Merge compaction prompts: Config > defaults
    this._compactionPrompts = {
      ...DEFAULT_COMPACTION_PROMPTS,
      ...(config.compactionPrompts ?? {}),
    };

    // Create Compactor
    this._compactor = new Compactor({
      sessionManager: this.sessionManager,
      hookRunner: this._hookRunner,
      compactionSettings: this._compactionSettings,
      compactionPrompts: this._compactionPrompts,
    });

    // Create RetryHandler
    this._retryHandler = new RetryHandler(config.retrySettings, {
      onStart: (attempt, maxAttempts, delayMs, errorMessage) => {
        this._emit({
          type: "auto_retry_start",
          attempt,
          maxAttempts,
          delayMs,
          errorMessage,
        });
      },
      onEnd: (success, attempt, finalError) => {
        this._emit({
          type: "auto_retry_end",
          success,
          attempt,
          finalError,
        });
      },
    });

    this.agent.steeringMode = config.steeringMode ?? "all";
    this.agent.followUpMode = config.followUpMode ?? "all";

    // Restore persisted messages from SessionManager into Agent state.
    const sessionContext = this.sessionManager.buildSessionContext();
    if (sessionContext.messages.length > 0) {
      this.agent.state.messages = sessionContext.messages;
    }

    // Always subscribe to agent events for internal handling
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
    this._installAgentToolHooks();

    this._refreshToolRegistry({
      activeToolNames: this._initialActiveToolNames,
      includeAllExtensionTools: true,
    });

    // Wire context:build hook: let extensions modify messages before each LLM call
    this.agent.transformContext = async (messages, _signal) => {
      return this._hookRunner.transformContext(messages);
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
        const runner = this._hookRunner;
        if (runner.hasHandlers("provider:before-request")) {
          try {
            const modified = await runner.beforeProviderRequest(options.params);
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
      const runner = this._hookRunner;
      if (!runner.hasHandlers("tool:call")) {
        return undefined;
      }

      await this._agentEventQueue;

      try {
        return await runner.beforeToolCall({
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
      const runner = this._hookRunner;
      if (!runner.hasHandlers("tool:result")) {
        return undefined;
      }

      const hookResult = await runner.afterToolCall({
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
    if (event.type !== "agent_end") return;

    const lastAssistant = this._findLastAssistantInMessages(event.messages);
    if (!lastAssistant) return;

    this._retryHandler.prepareRetryIfNeeded(lastAssistant);
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
        if (assistantMsg.finishReason !== "error" && this._retryHandler.attempt > 0) {
          this._retryHandler.resetOnSuccess();
        }
      }
    }

    // Check auto-retry and auto-compaction after agent completes
    if (event.type === "agent_end" && this._lastAssistantMessage) {
      this._contextWindowCheckDone = false;
      const msg = this._lastAssistantMessage;
      this._lastAssistantMessage = undefined;

      // Check for retryable errors first (overloaded, rate limit, server errors)
      if (this._retryHandler.isRetryableError(msg)) {
        const didRetry = await this._handleRetryableError(msg);
        if (didRetry) return; // Retry was initiated, don't proceed to compaction
      }

      this._retryHandler.waitForRetry().then(() => {});
      await this._checkCompaction(msg);
    }
  }

  /** Resolve the pending retry promise — delegated to RetryHandler */
  private _resolveRetry(): void {
    // RetryHandler handles this internally now
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
      await this._hookRunner.emitLifecycle({ type: "agent:start" });
    } else if (event.type === "agent_end") {
      await this._hookRunner.emitLifecycle({ type: "agent:end", messages: event.messages });
    } else if (event.type === "turn_start") {
      await this._hookRunner.emitLifecycle({
        type: "turn:start",
        turnIndex: this._turnIndex,
        timestamp: Date.now(),
      });
    } else if (event.type === "turn_end") {
      await this._hookRunner.emitLifecycle({
        type: "turn:end",
        turnIndex: this._turnIndex,
        message: event.message,
        toolResults: event.toolResults,
      });
      this._turnIndex++;
    } else if (event.type === "message_start") {
      await this._hookRunner.emitLifecycle({
        type: "message:start",
        message: event.message,
      });
    } else if (event.type === "message_update") {
      await this._hookRunner.emitLifecycle({
        type: "message:update",
        message: event.message,
        assistantMessageEvent: event.assistantMessageEvent,
      });
    } else if (event.type === "message_end") {
      await this._hookRunner.emitLifecycle({
        type: "message:end",
        message: event.message,
      });
    } else if (event.type === "tool_execution_start") {
      await this._hookRunner.emitLifecycle({
        type: "tool:execution:start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      });
    } else if (event.type === "tool_execution_end") {
      await this._hookRunner.emitLifecycle({
        type: "tool:execution:end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      });
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
    this._hookRunner.clear();
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
    return this._retryHandler.attempt;
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
  getAllTools(): Map<string, AgentTool> {
    return new Map(this._toolRegistry);
  }

  getToolDefinition(name: string): AgentTool | undefined {
    return this._toolRegistry.get(name);
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
  setContextWindow(value: number): void {
    this._contextWindow = value;
  }

  /** Update the compaction reserve token threshold. */
  setCompactionReserveTokens(tokens: number): void {
    this._compactionSettings = { ...this._compactionSettings, reserveTokens: tokens };
    this._compactor.updateSettings({ reserveTokens: tokens });
  }

  /** Update the compaction keep-recent token threshold. */
  setCompactionKeepRecentTokens(tokens: number): void {
    this._compactionSettings = { ...this._compactionSettings, keepRecentTokens: tokens };
    this._compactor.updateSettings({ keepRecentTokens: tokens });
  }

  /** Update the retry attempt limit. */
  setRetryMaxRetries(maxRetries: number): void {
    this._retryHandler.updateSettings({ maxRetries });
  }

  /** Update the retry base delay. */
  setRetryBaseDelayMs(delayMs: number): void {
    this._retryHandler.updateSettings({ baseDelayMs: delayMs });
  }

  /** Update the retry max delay. */
  setRetryMaxDelayMs(delayMs: number): void {
    this._retryHandler.updateSettings({ maxDelayMs: delayMs });
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

    // Snippets and guidelines are no longer tracked by agent — core handles prompt assembly.
    // But we still pass the structure for backward-compatible hooks.

    return {
      cwd: this.sessionManager.getCwd(),
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
    const result = await this._hookRunner.beforeAgentStart({
      prompt: promptText,
      images,
      systemPrompt: this.agent.state.systemPrompt,
      systemPromptOptions: this._collectToolPromptContext(),
    });

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
   */
  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.agent.steeringMode = mode;
  }

  /**
   * Set follow-up message mode.
   */
  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.agent.followUpMode = mode;
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

      const result = await this._compactor.execute({
        model: this.model,
        signal: this._compactionAbortController.signal,
        customInstructions,
      });

      if (!result) {
        const pathEntries = this.sessionManager.getBranch();
        const lastEntry = pathEntries[pathEntries.length - 1];
        if (lastEntry?.type === "compaction") {
          throw new Error("Already compacted");
        }
        throw new Error("Nothing to compact (session too small)");
      }

      // Update agent messages and emit session:compact
      const postResult = await this._compactor.postCompaction(result.summary, result.fromExtension);
      this.agent.state.messages = postResult.agentMessages;

      const compactionResult: CompactionResult = {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        details: result.details,
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

      const result = await this._compactor.execute({
        model: this.model,
        signal: this._autoCompactionAbortController.signal,
      });

      if (!result) {
        this._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: false,
          willRetry: false,
        });
        return;
      }

      // Update agent messages and emit session:compact
      const postResult = await this._compactor.postCompaction(result.summary, result.fromExtension);
      this.agent.state.messages = postResult.agentMessages;

      const compactionResult: CompactionResult = {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        details: result.details,
      };
      this._emit({
        type: "compaction_end",
        reason,
        result: compactionResult,
        aborted: false,
        willRetry,
      });

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
  setAutoCompactionEnabled(enabled: boolean): void {
    this._compactionSettings.enabled = enabled;
  }

  /** Whether auto-compaction is enabled */
  get autoCompactionEnabled(): boolean {
    return this._compactionSettings.enabled;
  }

  /**
   * Apply an extension tool snapshot from core.
   * Only updates the extension tools layer — base and custom tools are untouched.
   */
  applyToolState(snapshot: ExtensionToolSnapshot): void {
    this._extensionTools = new Map(snapshot.tools);
    this._refreshToolRegistry({
      activeToolNames: snapshot.activeToolNames,
    });
  }

  private _refreshToolRegistry(options?: {
    activeToolNames?: string[];
    includeAllExtensionTools?: boolean;
  }): void {
    const previousActiveToolNames = this.getActiveToolNames();
    const allowedToolNames = this._allowedToolNames;
    const isAllowedTool = (name: string): boolean =>
      !allowedToolNames || allowedToolNames.has(name);

    // Merge base tools + extension tools + custom tools
    const toolRegistry = new Map<string, AgentTool>();

    // base tools
    for (const [name, tool] of this._baseToolDefinitions) {
      if (isAllowedTool(name)) {
        toolRegistry.set(name, tool);
      }
    }

    // extension tools (from snapshot)
    for (const [name, tool] of this._extensionTools) {
      if (isAllowedTool(name)) {
        toolRegistry.set(name, tool);
      }
    }

    // custom tools
    for (const [name, tool] of this._customTools) {
      if (isAllowedTool(name)) {
        toolRegistry.set(name, tool);
      }
    }

    this._toolRegistry = toolRegistry;

    // Compute active tools
    const nextActiveToolNames = (options?.activeToolNames ?? previousActiveToolNames).filter(
      (name) => isAllowedTool(name),
    );

    if (options?.includeAllExtensionTools) {
      for (const name of this._extensionTools.keys()) {
        if (!nextActiveToolNames.includes(name)) {
          nextActiveToolNames.push(name);
        }
      }
    }

    this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
  }

  // =========================================================================
  // Auto-Retry
  // =========================================================================

  /**
   * Handle retryable errors with exponential backoff.
   * @returns true if retry was initiated, false if max retries exceeded or disabled
   */
  private async _handleRetryableError(message: AssistantMessage): Promise<boolean> {
    const result = await this._retryHandler.handleRetryableError(message);
    if (result) {
      // Remove error message from agent state
      const messages = this.agent.state.messages;
      if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
        this.agent.state.messages = messages.slice(0, -1);
      }

      // Retry via continue()
      setTimeout(() => {
        this.agent.continue().catch(() => {});
      }, 0);
    }
    return result;
  }

  /**
   * Cancel in-progress retry.
   */
  abortRetry(): void {
    this._retryHandler.abort();
  }

  /**
   * Wait for any in-progress retry to complete.
   * Returns immediately if no retry is in progress.
   */
  private async waitForRetry(): Promise<void> {
    await this._retryHandler.waitForRetry();
    await this.agent.waitForIdle();
  }

  /** Whether auto-retry is currently in progress */
  get isRetrying(): boolean {
    return this._retryHandler.isRetrying;
  }

  /** Whether auto-retry is enabled */
  get autoRetryEnabled(): boolean {
    return this._retryHandler.enabled;
  }

  /**
   * Toggle auto-retry setting.
   */
  setAutoRetryEnabled(enabled: boolean): void {
    this._retryHandler.enabled = enabled;
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
  // Hook System
  // =========================================================================

  /**
   * Check if hooks have handlers for a specific event type.
   */
  hasHookHandlers(eventType: string): boolean {
    return this._hookRunner.hasHandlers(eventType);
  }

  /**
   * Get the hook runner (for core to register error handlers, etc.).
   */
  get hookRunner(): HookRunner {
    return this._hookRunner;
  }
}
