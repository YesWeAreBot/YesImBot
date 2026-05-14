import { ExtensionRunner } from "@yesimbot/agent";
import type { ExtensionAPI, ExtensionCleanup, ExtensionDefinition } from "@yesimbot/agent/session";
import { Service, Logger, Context } from "koishi";

declare module "koishi" {
  export interface Context {
    "yesimbot.extension": ExtensionService;
  }
}

/**
 * 频道上下文信息（通用类型，用于 runtime、extension、session 等模块）
 */
export interface ChannelContext {
  /** 平台标识，如 "onebot"、"sandbox:6nxstem9j43" */
  platform: string;
  /** 频道标识 */
  channelId: string;
  /** 频道类型 */
  type: "private" | "group";
}

/**
 * Athena 扩展定义，支持可选的频道上下文
 *
 * 已有扩展无需修改，context 参数可选
 * 新扩展可通过 context 实现频道感知
 */
export interface AthenaExtensionDefinition {
  id: string;
  order?: number;
  setup(
    api: ExtensionAPI,
    context?: ChannelContext,
  ): void | Promise<void> | ExtensionCleanup | Promise<ExtensionCleanup>;
}

export interface ExtensionConfig {
  basePath: string;
  chatModel: string;
  logLevel?: number;
}

export class ExtensionService extends Service<ExtensionConfig> {
  readonly logger: Logger;

  private definitions = new Map<string, AthenaExtensionDefinition>();
  private runnerContexts = new Map<ExtensionRunner, ChannelContext>();

  constructor(
    public ctx: Context,
    public config: ExtensionConfig,
  ) {
    super(ctx, "yesimbot.extension");
    this.logger = ctx.logger("yesimbot.extension");
    this.logger.level = config.logLevel ?? 2;
  }

  protected async start() {
    this.logger.info("Starting yesimbot extension service");
  }

  public registerExtension(extension: AthenaExtensionDefinition) {
    this.definitions.set(extension.id, extension);
  }

  public unregisterExtension(id: string) {
    this.definitions.delete(id);
  }

  public getExtension(id: string): AthenaExtensionDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * 注册 runner 并绑定频道上下文
   */
  public registerRunner(runner: ExtensionRunner, context: ChannelContext) {
    this.runnerContexts.set(runner, context);
  }

  public unregisterRunner(runner: ExtensionRunner) {
    this.runnerContexts.delete(runner);
  }

  /**
   * 获取所有扩展，自动注入频道上下文
   *
   * 返回 agent 包的 ExtensionDefinition，通过闭包捕获 context
   */
  public getAllExtensions(context: ChannelContext): ExtensionDefinition[] {
    return Array.from(this.definitions.values()).map((def) => ({
      id: def.id,
      order: def.order,
      setup: (api: ExtensionAPI) => def.setup(api, context),
    }));
  }
}
