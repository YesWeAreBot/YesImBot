import type { HookRunner, SessionManager } from "@yesimbot/agent/session";
import type { Logger } from "koishi";

import type {
  Channel,
  ChannelReloadResult,
  ChannelRuntime,
  ChannelRuntimeError,
  ExtensionBinding,
  ExtensionDefinition,
  ExtensionToolSnapshot,
  ReloadSummary,
  SpeakElementPromptContext,
} from "../../services/extension/types.js";
import type { SpeakElementDefinition, SpeakElementPromptInfo } from "../bot/types.js";
import { createExtensionBinding } from "./context.js";
import { buildToolSnapshotFromBindings } from "./tools.js";

export interface CreateExtensionChannelRuntimeOptions {
  channel: Channel;
  hookRunner: HookRunner;
  sessionManager: SessionManager;
  applyToolState(snapshot: ExtensionToolSnapshot): void;
  sendMessage(message: unknown, options?: unknown): Promise<void>;
  sendUserMessage(content: unknown, options?: unknown): Promise<void>;
  appendEntry(customType: string, data?: unknown): void;
  setSessionName(name: string): void;
  getSessionName(): string | undefined;
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
  registerSpeakElement?(definition: SpeakElementDefinition): () => void;
}

interface ChannelRuntimeState {
  channelKey: string;
  channel: Channel;
  options: CreateExtensionChannelRuntimeOptions;
  hookRunner: HookRunner;
  bindings: ExtensionBinding[];
  errors: ChannelRuntimeError[];
}

export interface ExtensionRuntimeManagerDeps {
  logger: Logger;
  getDefinitions(): ExtensionDefinition[];
}

export class ExtensionRuntimeManager {
  private readonly logger: Logger;
  private readonly getDefinitions: () => ExtensionDefinition[];
  private readonly channels = new Map<string, ChannelRuntimeState>();

  constructor(deps: ExtensionRuntimeManagerDeps) {
    this.logger = deps.logger;
    this.getDefinitions = deps.getDefinitions;
  }

  async createChannelRuntime(
    options: CreateExtensionChannelRuntimeOptions,
  ): Promise<ChannelRuntime> {
    const key = channelKeyOf(options.channel);
    if (this.channels.has(key)) await this.disposeChannelRuntime(options.channel);
    const state: ChannelRuntimeState = {
      channelKey: key,
      channel: options.channel,
      options,
      hookRunner: options.hookRunner,
      bindings: [],
      errors: [],
    };
    this.channels.set(key, state);
    await this.reloadChannel(state);
    return this.buildChannelRuntime(state);
  }

  async disposeChannelRuntime(channel: Channel): Promise<void> {
    const key = channelKeyOf(channel);
    const state = this.channels.get(key);
    if (!state) return;
    for (const binding of state.bindings) {
      try {
        await binding.cleanup?.dispose?.();
      } catch (error) {
        this.logger.warn(
          `Cleanup error for channel ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    state.hookRunner.clear();
    state.options.applyToolState({ tools: new Map(), activeToolNames: [] });
    this.channels.delete(key);
  }

  getChannelRuntime(channel: Channel): ChannelRuntime | undefined {
    const state = this.channels.get(channelKeyOf(channel));
    return state ? this.buildChannelRuntime(state) : undefined;
  }

  buildToolSnapshot(channel: Channel): ExtensionToolSnapshot {
    const state = this.channels.get(channelKeyOf(channel));
    return state
      ? buildToolSnapshotFromBindings(state.bindings)
      : { tools: new Map(), activeToolNames: [] };
  }

  getPromptToolContext(channel: Channel): {
    selectedTools: string[];
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
  } {
    const state = this.channels.get(channelKeyOf(channel));
    if (!state) return { selectedTools: [], toolSnippets: {}, promptGuidelines: [] };
    const activeToolNames = state.options.getActiveTools();
    const toolSnippets: Record<string, string> = {};
    const promptGuidelinesSet = new Set<string>();
    for (const binding of state.bindings) {
      for (const [name, tool] of binding.tools) {
        if (tool.promptSnippet) toolSnippets[name] = tool.promptSnippet;
        for (const guideline of tool.promptGuidelines ?? []) {
          const trimmed = guideline.trim();
          if (trimmed) promptGuidelinesSet.add(trimmed);
        }
      }
    }
    return {
      selectedTools: activeToolNames.filter((name) => !!toolSnippets[name]),
      toolSnippets,
      promptGuidelines: [...promptGuidelinesSet],
    };
  }

  getPromptSpeakElementContext(channel: Channel): SpeakElementPromptContext {
    const state = this.channels.get(channelKeyOf(channel));
    if (!state) return { elements: [] };
    const elements: SpeakElementPromptInfo[] = [];
    for (const binding of state.bindings) {
      for (const definition of binding.speakElements.values()) {
        elements.push({
          tag: definition.tag,
          syntax: definition.syntax,
          description: definition.description,
          examples: definition.examples ?? [],
        });
      }
    }
    return { elements };
  }

  async reloadAllChannels(trigger: string): Promise<ReloadSummary> {
    const results: ChannelReloadResult[] = [];
    for (const state of this.channels.values()) {
      try {
        results.push(await this.reloadChannel(state));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Channel ${state.channelKey} reload threw unexpectedly: ${message}`);
        results.push({
          channelKey: state.channelKey,
          success: false,
          loadedCount: 0,
          error: message,
        });
      }
    }
    const successCount = results.filter((result) => result.success).length;
    const failureCount = results.length - successCount;
    if (failureCount > 0) {
      this.logger.warn(`Reload ${trigger}: ${successCount}/${results.length} channels succeeded`);
    }
    return {
      totalChannels: results.length,
      successCount,
      failureCount,
      results,
      allSucceeded: failureCount === 0,
    };
  }

  async stop(): Promise<void> {
    for (const state of [...this.channels.values()]) {
      await this.disposeChannelRuntime(state.channel);
    }
  }

  private async reloadChannel(state: ChannelRuntimeState): Promise<ChannelReloadResult> {
    const sorted = this.getDefinitions().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const old of state.bindings) {
      try {
        await old.cleanup?.dispose?.();
      } catch (error) {
        state.errors.push({
          extensionId: old.id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
    const nextBindings: ExtensionBinding[] = [];
    const reloadErrors: ChannelRuntimeError[] = [];
    for (const definition of sorted) {
      try {
        nextBindings.push(await createExtensionBinding(definition, state.options));
      } catch (error) {
        reloadErrors.push({
          extensionId: definition.id,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
    state.bindings = nextBindings;
    state.errors.push(...reloadErrors);
    this.installBindings(state.hookRunner, nextBindings);
    state.options.applyToolState(buildToolSnapshotFromBindings(nextBindings));
    return {
      channelKey: state.channelKey,
      success: reloadErrors.length === 0,
      loadedCount: nextBindings.length,
      failedExtensions: reloadErrors.map((error) => error.extensionId),
      error: reloadErrors.length
        ? reloadErrors.map((error) => `${error.extensionId}: ${error.error}`).join("; ")
        : undefined,
    };
  }

  private installBindings(hookRunner: HookRunner, bindings: ExtensionBinding[]): void {
    hookRunner.clear();
    for (const binding of bindings) {
      for (const [event, handlers] of binding.handlers) {
        for (const handler of handlers) hookRunner.on(event, handler);
      }
    }
  }

  private buildChannelRuntime(state: ChannelRuntimeState): ChannelRuntime {
    return {
      channelKey: state.channelKey,
      toolSnapshot: buildToolSnapshotFromBindings(state.bindings),
      hookRunner: state.hookRunner,
      errors: [...state.errors],
      dispose: () => this.disposeChannelRuntime(state.channel),
    };
  }
}

function channelKeyOf(channel: Pick<Channel, "platform" | "channelId">): string {
  return `${channel.platform}:${channel.channelId}`;
}
