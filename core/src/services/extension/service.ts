import { Context, Logger, Service } from "koishi";

import type {
  ExtensionDefinition,
  ExtensionDefinitionChange,
  ExtensionDefinitionListener,
  ExtensionRegistry,
} from "../../internal/extension/types.js";

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

  async registerExtension(extension: ExtensionDefinition): Promise<void> {
    this.definitions.set(extension.id, extension);
    this.logger.info(`Registered extension: ${extension.id}`);
    await this.notifyDefinitions({ type: "registered", extensionId: extension.id });
  }

  async unregisterExtension(id: string): Promise<void> {
    if (!this.definitions.has(id)) {
      this.logger.warn(`Extension not found: ${id}`);
      return;
    }
    this.definitions.delete(id);
    this.logger.info(`Unregistered extension: ${id}`);
    await this.notifyDefinitions({ type: "unregistered", extensionId: id });
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

  private async notifyDefinitions(change: ExtensionDefinitionChange): Promise<void> {
    for (const listener of this.definitionListeners) {
      try {
        await listener(change);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Extension definition subscriber failed for ${change.extensionId}: ${message}`,
        );
      }
    }
  }
}
