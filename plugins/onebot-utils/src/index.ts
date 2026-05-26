import { Context, Logger, Schema, Service } from "koishi";
import type { ExtensionContext } from "koishi-plugin-yesimbot";

export interface OnebotUtilsConfig {}

export default class OnebotUtilsPlugin extends Service<OnebotUtilsConfig> {
  static name = "yesimbot-onebot-utils";
  static inject = ["yesimbot.extension"];
  static Config: Schema<OnebotUtilsConfig> = Schema.object({});

  readonly logger: Logger;

  constructor(ctx: Context, config: OnebotUtilsConfig) {
    super(ctx, config);
    this.config = config;
    this.logger = ctx.logger("yesimbot.onebot-utils");
  }

  override async start(): Promise<void> {
    const logger = this.logger;
    await this.ctx["yesimbot.extension"].registerExtension({
      id: "onebot-utils",
      setup(ctx: ExtensionContext) {},
    });
  }
}
