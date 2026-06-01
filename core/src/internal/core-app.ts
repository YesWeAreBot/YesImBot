import type { Context } from "koishi";

import { Config } from "../config.js";
import { ModelService } from "../services/model/service.js";
import { createFallbackListeners } from "./platform/fallback-listeners.js";
import { PlatformGateway } from "./platform/gateway.js";
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
    const platformGateway = new PlatformGateway(ctx);

    for (const listener of createFallbackListeners()) {
      platformGateway.registerListener(listener);
    }

    const runtimeController = new RuntimeController({
      ctx,
      config: config as RuntimeControllerConfig,
      modelService,
      extensionRegistry: extensionService,
      sessionStore,
      platformGateway,
    });
    let disposeDefinitionSubscription: (() => void) | undefined;
    ctx.on("ready", async () => {
      await platformGateway.start();
      await sessionStore.start();
      await runtimeController.start();
      disposeDefinitionSubscription = extensionService.subscribeDefinitions((change) => {
        void runtimeController.reloadAllChannels(`${change.type}:${change.extensionId}`);
      });
    });
    ctx.on("dispose", async () => {
      disposeDefinitionSubscription?.();
      disposeDefinitionSubscription = undefined;
      await runtimeController.stop();
      await platformGateway.stop();
      await sessionStore.stop();
    });
  }
}
