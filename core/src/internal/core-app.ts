import type { Context } from "koishi";

import { Config } from "../config.js";
import { ModelService } from "../services/model/service.js";
import { BotModule } from "./bot/index.js";
import { RuntimeController, RuntimeControllerConfig } from "./runtime/index.js";
import { SessionStore } from "./session/index.js";

export class CoreApp {
  static readonly name = "yesimbot.core";
  static readonly inject = ["yesimbot.model", "yesimbot.extension", "database"];
  constructor(
    public ctx: Context,
    public config: Config,
  ) {
    const modelService = ctx["yesimbot.model"] as ModelService;
    const extensionService = ctx["yesimbot.extension"];
    const sessionStore = new SessionStore(ctx, config);
    const botModule = new BotModule({
      ctx,
      config: {
        logLevel: config.logLevel,
        consumeMessages: config.consumeMessages,
      },
    });
    const runtimeController = new RuntimeController({
      ctx,
      config: config as RuntimeControllerConfig,
      modelService,
      extensionRegistry: extensionService,
      sessionStore,
      botModule,
    });
    let disposeDefinitionSubscription: (() => void) | undefined;
    ctx.on("ready", async () => {
      await botModule.start();
      await sessionStore.start();
      await runtimeController.start();
      disposeDefinitionSubscription = extensionService.subscribeDefinitions((change) => {
        void runtimeController.reloadAllChannels(
          `${change.type}:${change.extensionId}`,
        );
      });
    });
    ctx.on("dispose", async () => {
      disposeDefinitionSubscription?.();
      disposeDefinitionSubscription = undefined;
      await runtimeController.stop();
      await botModule.stop();
      await sessionStore.stop();
    });
  }
}
