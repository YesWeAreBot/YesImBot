/**
 * Extension runner - executes extensions and manages their lifecycle.
 */

import { ImagePart, LanguageModel } from "ai";

import { AgentMessage } from "../../agent/types.js";
import { EventBus } from "../event-bus.js";
import { SessionManager } from "../session-manager.js";
import { createExtensionBinding, createExtensionBindingSync } from "./loader.js";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEvent,
  BuildSystemPromptOptions,
  CompactOptions,
  ContextEvent,
  ContextEventResult,
  ContextUsage,
  ExtensionBinding,
  ExtensionActions,
  ExtensionContext,
  ExtensionContextActions,
  ExtensionDefinition,
  ExtensionError,
  ExtensionEvent,
  ExtensionRuntime,
  SessionBeforeCompactResult,
  SessionShutdownEvent,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
} from "./types.js";

/** Combined result from all before_agent_start handlers */
interface BeforeAgentStartCombinedResult {
  messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
  systemPrompt?: string;
}

/**
 * Events handled by the generic emit() method.
 * Events with dedicated emitXxx() methods are excluded for stronger type safety.
 */
type RunnerEmitEvent = Exclude<
  ExtensionEvent,
  | ToolCallEvent
  | ToolResultEvent
  | ContextEvent
  | BeforeProviderRequestEvent
  | BeforeAgentStartEvent
>;

type SessionBeforeEvent = Extract<
  RunnerEmitEvent,
  {
    type: "session:before-compact";
  }
>;

type SessionBeforeEventResult = SessionBeforeCompactResult;

type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends {
  type: "session:before-compact";
}
  ? SessionBeforeCompactResult | undefined
  : undefined;

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type ReloadHandler = () => Promise<void>;

export type ShutdownHandler = () => void;

/**
 * Helper function to emit session:shutdown event to extensions.
 * Returns true if the event was emitted, false if there were no handlers.
 */
export async function emitSessionShutdownEvent(
  extensionRunner: ExtensionRunner,
  event: SessionShutdownEvent,
): Promise<boolean> {
  if (extensionRunner.hasHandlers("session:shutdown")) {
    await extensionRunner.emit(event);
    return true;
  }
  return false;
}

export class ExtensionRunner {
  private bindings: ExtensionBinding[];
  private runtime: ExtensionRuntime;
  private cwd: string;
  private sessionManager: SessionManager;
  private _eventBus: EventBus;
  private errorListeners: Set<ExtensionErrorListener> = new Set();
  private getModel: () => LanguageModel | undefined = () => undefined;
  private isIdleFn: () => boolean = () => true;
  private getSignalFn: () => AbortSignal | undefined = () => undefined;
  private abortFn: () => void = () => {};
  private hasPendingMessagesFn: () => boolean = () => false;
  private getContextUsageFn: () => ContextUsage | undefined = () => undefined;
  private compactFn: (options?: CompactOptions) => void = () => {};
  private getSystemPromptFn: () => string = () => "";
  private staleMessage: string | undefined;
  private _currentGeneration: number = 0;

  constructor(
    bindings: ExtensionBinding[],
    runtime: ExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    eventBus: EventBus,
  ) {
    this.bindings = bindings;
    this.runtime = runtime;
    this.cwd = cwd;
    this.sessionManager = sessionManager;
    this._eventBus = eventBus;
  }

  get currentGeneration(): number {
    return this._currentGeneration;
  }

  bindCore(actions: ExtensionActions, contextActions: ExtensionContextActions): void {
    // Copy actions into the shared runtime (all extension APIs reference this)
    this.runtime.sendMessage = actions.sendMessage;
    this.runtime.sendUserMessage = actions.sendUserMessage;
    this.runtime.appendEntry = actions.appendEntry;
    this.runtime.setSessionName = actions.setSessionName;
    this.runtime.getSessionName = actions.getSessionName;

    this.runtime.getActiveTools = actions.getActiveTools;
    this.runtime.setActiveTools = actions.setActiveTools;
    this.runtime.refreshTools = actions.refreshTools;

    // Context actions (required)
    this.getModel = contextActions.getModel;
    this.isIdleFn = contextActions.isIdle;
    this.getSignalFn = contextActions.getSignal;
    this.abortFn = contextActions.abort;
    this.hasPendingMessagesFn = contextActions.hasPendingMessages;
    this.getContextUsageFn = contextActions.getContextUsage;
    this.compactFn = contextActions.compact;
    this.getSystemPromptFn = contextActions.getSystemPrompt;
  }

  invalidate(
    message = "This extension instance is stale after session replacement or reload.",
  ): void {
    if (!this.staleMessage) {
      this.staleMessage = message;
      this.runtime.invalidate(message);
    }
  }

  private assertActive(): void {
    if (this.staleMessage) {
      throw new Error(this.staleMessage);
    }
  }

  onError(listener: ExtensionErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emitError(error: ExtensionError): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  hasHandlers(eventType: string): boolean {
    for (const binding of this.bindings) {
      const handlers = binding.handlers.get(eventType);
      if (handlers && handlers.length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Create an ExtensionContext for use in event handlers and tool execution.
   * Context values are resolved at call time, so changes via bindCore/bindUI are reflected.
   */
  createContext(): ExtensionContext {
    const assertActive = () => this.assertActive();
    const getModel = () => this.getModel();
    const getCwd = () => this.cwd;
    const getSessionManager = () => this.sessionManager;
    const isIdle = () => this.isIdleFn();
    const getSignal = () => this.getSignalFn();
    const abort = () => this.abortFn();
    const hasPendingMessages = () => this.hasPendingMessagesFn();
    const getContextUsage = () => this.getContextUsageFn();
    const compact = (options?: CompactOptions) => this.compactFn(options);
    const getSystemPrompt = () => this.getSystemPromptFn();
    return {
      get cwd() {
        assertActive();
        return getCwd();
      },
      get sessionManager() {
        assertActive();
        return getSessionManager();
      },

      get model() {
        assertActive();
        return getModel();
      },
      isIdle: () => {
        assertActive();
        return isIdle();
      },
      get signal() {
        assertActive();
        return getSignal();
      },
      abort: () => {
        assertActive();
        abort();
      },
      hasPendingMessages: () => {
        assertActive();
        return hasPendingMessages();
      },

      getContextUsage: () => {
        assertActive();
        return getContextUsage();
      },
      compact: (options) => {
        assertActive();
        compact(options);
      },
      getSystemPrompt: () => {
        assertActive();
        return getSystemPrompt();
      },
    };
  }

  private isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
    return event.type === "session:before-compact";
  }

  async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
    const ctx = this.createContext();
    let result: SessionBeforeEventResult | undefined;

    for (const binding of this.bindings) {
      const handlers = binding.handlers.get(event.type);
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = await handler(event, ctx);

          if (this.isSessionBeforeEvent(event) && handlerResult) {
            result = handlerResult as SessionBeforeEventResult;
            if (result.cancel) {
              return result as RunnerEmitResult<TEvent>;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.emitError({
            event: event.type,
            error: message,
            stack,
          });
        }
      }
    }

    return result as RunnerEmitResult<TEvent>;
  }

  async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
    const ctx = this.createContext();
    const currentEvent: ToolResultEvent = { ...event };
    let modified = false;

    for (const binding of this.bindings) {
      const handlers = binding.handlers.get("tool:result");
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const handlerResult = (await handler(currentEvent, ctx)) as
            | ToolResultEventResult
            | undefined;
          if (!handlerResult) continue;

          if (handlerResult.content !== undefined) {
            currentEvent.content = handlerResult.content;
            modified = true;
          }
          if (handlerResult.details !== undefined) {
            currentEvent.details = handlerResult.details;
            modified = true;
          }
          if (handlerResult.isError !== undefined) {
            currentEvent.isError = handlerResult.isError;
            modified = true;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.emitError({
            event: "tool:result",
            error: message,
            stack,
          });
        }
      }
    }

    if (!modified) {
      return undefined;
    }

    return {
      content: currentEvent.content,
      details: currentEvent.details,
      isError: currentEvent.isError,
    };
  }

  async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
    const ctx = this.createContext();
    let result: ToolCallEventResult | undefined;

    for (const binding of this.bindings) {
      const handlers = binding.handlers.get("tool:call");
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        const handlerResult = await handler(event, ctx);

        if (handlerResult) {
          result = handlerResult as ToolCallEventResult;
          if (result.block) {
            return result;
          }
        }
      }
    }

    return result;
  }

  async emitContextBuild(messages: AgentMessage[]): Promise<AgentMessage[]> {
    const ctx = this.createContext();
    let currentMessages = structuredClone(messages);

    for (const binding of this.bindings) {
      const handlers = binding.handlers.get("context:build");
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: ContextEvent = { type: "context:build", messages: currentMessages };
          const handlerResult = await handler(event, ctx);

          if (handlerResult && (handlerResult as ContextEventResult).messages) {
            currentMessages = (handlerResult as ContextEventResult).messages!;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.emitError({
            event: "context:build",
            error: message,
            stack,
          });
        }
      }
    }

    return currentMessages;
  }

  async emitBeforeProviderRequest(payload: unknown): Promise<unknown> {
    const ctx = this.createContext();
    let currentPayload = payload;

    for (const binding of this.bindings) {
      const handlers = binding.handlers.get("provider:before-request");
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: BeforeProviderRequestEvent = {
            type: "provider:before-request",
            payload: currentPayload,
          };
          const handlerResult = await handler(event, ctx);
          if (handlerResult !== undefined) {
            currentPayload = handlerResult;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.emitError({
            event: "provider:before-request",
            error: message,
            stack,
          });
        }
      }
    }

    return currentPayload;
  }

  async emitBeforeAgentStart(
    prompt: string,
    images: ImagePart[] | undefined,
    systemPrompt: string,
    systemPromptOptions: BuildSystemPromptOptions,
  ): Promise<BeforeAgentStartCombinedResult | undefined> {
    let currentSystemPrompt = systemPrompt;
    const ctx = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.createContext()),
    ) as ExtensionContext;
    ctx.getSystemPrompt = () => {
      this.assertActive();
      return currentSystemPrompt;
    };
    const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
    let systemPromptModified = false;

    for (const binding of this.bindings) {
      const handlers = binding.handlers.get("agent:before-start");
      if (!handlers || handlers.length === 0) continue;

      for (const handler of handlers) {
        try {
          const event: BeforeAgentStartEvent = {
            type: "agent:before-start",
            prompt,
            images,
            systemPrompt: currentSystemPrompt,
            systemPromptOptions,
          };
          const handlerResult = await handler(event, ctx);

          if (handlerResult) {
            const result = handlerResult as BeforeAgentStartEventResult;
            if (result.message) {
              messages.push(result.message);
            }
            if (result.systemPrompt !== undefined) {
              currentSystemPrompt = result.systemPrompt;
              systemPromptModified = true;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.emitError({
            event: "agent:before-start",
            error: message,
            stack,
          });
        }
      }
    }

    if (messages.length > 0 || systemPromptModified) {
      return {
        messages: messages.length > 0 ? messages : undefined,
        systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
      };
    }

    return undefined;
  }

  /**
   * Reload all bindings with new definitions.
   * Invalidates old bindings, increments generation, creates new bindings.
   */
  async reload(definitions: ExtensionDefinition[]): Promise<void> {
    // 1. generation++ (old bindings become stale by generation mismatch)
    this._currentGeneration++;

    // 2. Dispose old bindings
    for (const binding of this.bindings) {
      try {
        await binding.cleanup?.dispose?.();
      } catch {
        // ignore cleanup errors
      }
    }

    // 3. Create new bindings (runtime must NOT be invalidated here,
    //    because setup() calls registerTool/on which call runtime.assertActive())
    const newBindings: ExtensionBinding[] = [];
    const sorted = [...definitions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const def of sorted) {
      try {
        const binding = await createExtensionBinding(
          def,
          this._currentGeneration,
          this.runtime,
          this._eventBus,
        );
        newBindings.push(binding);
      } catch (err) {
        this.emitError({
          event: "setup",
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    // 4. Replace bindings
    this.bindings = newBindings;
    this.runtime.refreshTools();
  }

  /**
   * Synchronous version of reload for constructor initialization.
   * Uses createExtensionBindingSync.
   */
  reloadSync(definitions: ExtensionDefinition[]): void {
    this._currentGeneration++;

    for (const binding of this.bindings) {
      try {
        binding.cleanup?.dispose?.();
      } catch {
        // ignore cleanup errors
      }
    }

    const newBindings: ExtensionBinding[] = [];
    const sorted = [...definitions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const def of sorted) {
      try {
        const binding = createExtensionBindingSync(
          def,
          this._currentGeneration,
          this.runtime,
          this._eventBus,
          () => this._currentGeneration,
        );
        newBindings.push(binding);
      } catch (err) {
        this.emitError({
          event: "setup",
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    this.bindings = newBindings;
    this.runtime.refreshTools();
  }

  /** Get current bindings (readonly). */
  getBindings(): readonly ExtensionBinding[] {
    return this.bindings;
  }
}
