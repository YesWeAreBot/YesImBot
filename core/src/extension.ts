import { ExtensionRegistry, ExtensionDefinition, ExtensionRunner } from "@yesimbot/agent";
import { Service, Logger, Context } from "koishi";

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

export class ExtensionService extends Service<ExtensionConfig> {
  readonly logger: Logger;
  private extensionRegistry: ExtensionRegistry;
  constructor(
    public ctx: Context,
    public config: ExtensionConfig,
  ) {
    super(ctx, "yesimbot.extension");
    this.logger = ctx.logger("yesimbot.extension");
    this.logger.level = config.logLevel ?? 2;

    this.extensionRegistry = new ExtensionRegistry();
  }

  protected async start() {
    this.logger.info("Starting yesimbot extension service");
  }

  public registerExtension(extension: ExtensionDefinition) {
    this.extensionRegistry.add(extension);
  }

  public unregisterExtension(id: string) {
    this.extensionRegistry.remove(id);
  }

  public getExtension(id: string) {
    return this.extensionRegistry.get(id);
  }

  public getAllExtensions() {
    return this.extensionRegistry.getAll();
  }

  public registerRunner(runner: ExtensionRunner) {
    this.extensionRegistry.registerRunner(runner);
  }

  public unregisterRunner(runner: ExtensionRunner) {
    this.extensionRegistry.unregisterRunner(runner);
  }
}
