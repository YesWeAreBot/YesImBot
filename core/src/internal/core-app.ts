import type { Context } from "koishi";

import type { ExtensionService } from "../services/extension/index.js";
import type { ModelService } from "../services/model/index.js";
import { BotModule } from "./bot/module.js";
import { ExtensionRuntimeManager } from "./extension/runtime.js";
import { RuntimeController, type RuntimeControllerConfig } from "./runtime/controller.js";
import { SessionStore } from "./session/store.js";
import type { SessionStoreConfig } from "./session/types.js";

type MaybePromise<T> = T | Promise<T>;

export interface InternalRuntimeModule {
  readonly name: string;
  start?(): MaybePromise<void>;
  stop?(): MaybePromise<void>;
}

export interface CoreAppConfig {
  basePath: string;
  chatModel: string;
  allowedChannels: Array<{ platform: string; channelId: string; type: "private" | "group" }>;
  logLevel?: number;
  consumeMessages?: boolean;
  runtimeSettings?: RuntimeControllerConfig["runtimeSettings"];
  base?: RuntimeControllerConfig["base"];
  attribute?: RuntimeControllerConfig["attribute"];
  interest?: RuntimeControllerConfig["interest"];
  lifecycle?: RuntimeControllerConfig["lifecycle"];
  createModules?: CoreAppModuleFactory;
}

export type CoreAppModuleFactory = (input: CoreAppFactoryInput) => InternalRuntimeModule[];

export interface CoreAppFactoryInput {
  ctx: Context;
  config: CoreAppConfig;
}

export interface CoreAppRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const name = "yesimbot.core-app";
export const inject = ["yesimbot.model", "yesimbot.extension", "database"];

function createDefaultModules({ ctx, config }: CoreAppFactoryInput): InternalRuntimeModule[] {
  const modelService = ctx["yesimbot.model"] as ModelService;
  const extensionService = ctx["yesimbot.extension"] as ExtensionService;
  const sessionStore = new SessionStore(ctx, config as SessionStoreConfig);
  const botModule = new BotModule({
    ctx,
    sessionStore,
    config: {
      logLevel: config.logLevel,
      consumeMessages: config.consumeMessages,
    },
  });
  const extensionRuntimeManager = new ExtensionRuntimeManager({
    logger: ctx.logger("yesimbot.extension-runtime"),
    getDefinitions: () => extensionService.getAllDefinitions(),
  });
  let disposeExtensionRuntimeManager: (() => void) | undefined;
  const runtimeController = new RuntimeController({
    ctx,
    config: config as RuntimeControllerConfig,
    modelService,
    extensionRegistry: extensionService,
    extensionRuntimeManager,
    sessionStore,
    botModule,
  });

  return [
    {
      name: "session-store",
      start: () => sessionStore.start(),
      stop: () => sessionStore.stop(),
    },
    {
      name: "bot-module",
      start: () => botModule.start(),
      stop: () => botModule.stop(),
    },
    {
      name: "extension-runtime-manager",
      start() {
        disposeExtensionRuntimeManager =
          extensionService.attachRuntimeManager(extensionRuntimeManager);
      },
      async stop() {
        disposeExtensionRuntimeManager?.();
        disposeExtensionRuntimeManager = undefined;
        await extensionRuntimeManager.stop();
      },
    },
    runtimeController,
  ];
}

export function createCoreAppRuntime(
  ctx: Context,
  config: CoreAppConfig,
  createModules: CoreAppModuleFactory = createDefaultModules,
): CoreAppRuntime {
  const logger = ctx.logger("yesimbot.core-app");
  logger.level = config.logLevel ?? 2;
  const modules = createModules({ ctx, config });
  const startedModules: InternalRuntimeModule[] = [];
  let started = false;

  return {
    async start() {
      if (started) return;
      try {
        for (const module of modules) {
          await module.start?.();
          startedModules.push(module);
        }
      } catch (error) {
        for (const module of [...startedModules].reverse()) {
          await module.stop?.();
        }
        startedModules.length = 0;
        throw error;
      }
      started = true;
      logger.info("Core App started");
    },
    async stop() {
      if (!started && startedModules.length === 0) return;
      for (const module of [...startedModules].reverse()) {
        await module.stop?.();
      }
      startedModules.length = 0;
      started = false;
      logger.info("Core App stopped");
    },
  };
}

export async function apply(ctx: Context, config: CoreAppConfig): Promise<void> {
  const runtime = createCoreAppRuntime(ctx, config, config.createModules);
  ctx.on("dispose", () => runtime.stop());
  await runtime.start();
}
