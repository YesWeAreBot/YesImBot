import { Context, Logger, Service } from "koishi";

import type {
  CreateExtensionChannelRuntimeOptions,
  ExtensionRuntimeManager,
} from "../../internal/extension/runtime.js";
import type {
  Channel,
  ChannelRuntime,
  ExtensionDefinition,
  ExtensionDefinitionChange,
  ExtensionDefinitionListener,
  ExtensionRegistry,
  ExtensionToolSnapshot,
  ReloadSummary,
  SpeakElementPromptContext,
} from "./types.js";

declare module "koishi" {
  export interface Context {
    "yesimbot.extension": ExtensionService;
  }
}

export interface ExtensionConfig {
  basePath: string;
  chatModel: string;
  logLevel?: number;
}

export class ExtensionService extends Service<ExtensionConfig> implements ExtensionRegistry {
  readonly logger: Logger;
  private readonly definitions = new Map<string, ExtensionDefinition>();
  private readonly definitionListeners = new Set<ExtensionDefinitionListener>();
  private runtimeManager?: ExtensionRuntimeManager;

  constructor(
    public ctx: Context,
    public config: ExtensionConfig,
  ) {
    super(ctx, "yesimbot.extension");
    this.logger = ctx.logger("yesimbot.extension");
    this.logger.level = config.logLevel ?? 2;
  }

  protected start(): void {
    this.logger.info("Starting yesimbot extension service");
  }

  async registerExtension(extension: ExtensionDefinition): Promise<ReloadSummary> {
    this.definitions.set(extension.id, extension);
    this.logger.info(`Registered extension: ${extension.id}`);
    return this.notifyDefinitions({ type: "registered", extensionId: extension.id });
  }

  async unregisterExtension(id: string): Promise<ReloadSummary> {
    if (!this.definitions.has(id)) {
      this.logger.warn(`Extension not found: ${id}`);
      return emptySummary();
    }
    this.definitions.delete(id);
    this.logger.info(`Unregistered extension: ${id}`);
    return this.notifyDefinitions({ type: "unregistered", extensionId: id });
  }

  getExtension(id: string): ExtensionDefinition | undefined {
    return this.definitions.get(id);
  }

  getAllDefinitions(): ExtensionDefinition[] {
    return [...this.definitions.values()];
  }

  subscribeDefinitions(listener: ExtensionDefinitionListener): () => void {
    this.definitionListeners.add(listener);
    return () => {
      this.definitionListeners.delete(listener);
    };
  }

  attachRuntimeManager(manager: ExtensionRuntimeManager): () => void {
    this.runtimeManager = manager;
    const dispose = this.subscribeDefinitions((change) =>
      manager.reloadAllChannels(`${change.type}:${change.extensionId}`),
    );
    return () => {
      dispose();
      if (this.runtimeManager === manager) this.runtimeManager = undefined;
    };
  }

  createChannelRuntime(options: CreateExtensionChannelRuntimeOptions): Promise<ChannelRuntime> {
    return this.requireRuntimeManager().createChannelRuntime(options);
  }

  disposeChannelRuntime(channel: Channel): Promise<void> {
    return this.requireRuntimeManager().disposeChannelRuntime(channel);
  }

  getChannelRuntime(channel: Channel): ChannelRuntime | undefined {
    return this.runtimeManager?.getChannelRuntime(channel);
  }

  buildToolSnapshot(channel: Channel): ExtensionToolSnapshot {
    return (
      this.runtimeManager?.buildToolSnapshot(channel) ?? { tools: new Map(), activeToolNames: [] }
    );
  }

  getPromptToolContext(channel: Channel): {
    selectedTools: string[];
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
  } {
    return (
      this.runtimeManager?.getPromptToolContext(channel) ?? {
        selectedTools: [],
        toolSnippets: {},
        promptGuidelines: [],
      }
    );
  }

  getPromptSpeakElementContext(channel: Channel): SpeakElementPromptContext {
    return this.runtimeManager?.getPromptSpeakElementContext(channel) ?? { elements: [] };
  }

  private requireRuntimeManager(): ExtensionRuntimeManager {
    if (!this.runtimeManager) {
      throw new Error("Extension Runtime Manager is not attached");
    }
    return this.runtimeManager;
  }

  private async notifyDefinitions(change: ExtensionDefinitionChange): Promise<ReloadSummary> {
    const summaries: ReloadSummary[] = [];
    for (const listener of this.definitionListeners) {
      try {
        const summary = await listener(change);
        if (summary) summaries.push(summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Extension definition subscriber failed for ${change.extensionId}: ${message}`,
        );
        summaries.push({
          totalChannels: 0,
          successCount: 0,
          failureCount: 1,
          results: [
            { channelKey: "definition-subscriber", success: false, loadedCount: 0, error: message },
          ],
          allSucceeded: false,
        });
      }
    }
    return mergeSummaries(summaries);
  }
}

function emptySummary(): ReloadSummary {
  return { totalChannels: 0, successCount: 0, failureCount: 0, results: [], allSucceeded: true };
}

function mergeSummaries(summaries: ReloadSummary[]): ReloadSummary {
  if (summaries.length === 0) return emptySummary();
  const results = summaries.flatMap((summary) => summary.results);
  const totalChannels = summaries.reduce((total, summary) => total + summary.totalChannels, 0);
  const successCount = summaries.reduce((total, summary) => total + summary.successCount, 0);
  const failureCount = summaries.reduce((total, summary) => total + summary.failureCount, 0);
  return {
    totalChannels,
    successCount,
    failureCount,
    results,
    allSucceeded: failureCount === 0,
  };
}
