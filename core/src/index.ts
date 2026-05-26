import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { Context } from "koishi";

import type { Config } from "./config.js";
import { CoreApp } from "./internal/core-app.js";
import { ChatHistoryPlugin } from "./services/extension/built-in/chat-history/index.js";
import { ExtensionService } from "./services/extension/index.js";
import { ModelService } from "./services/model/index.js";

export const name = "yesimbot";
export const inject = [];
export { Config } from "./config.js";

export async function apply(ctx: Context, config: Config) {
  if (config.basePath) {
    config.basePath = resolve(ctx.baseDir, config.basePath);
    if (!existsSync(config.basePath)) {
      mkdirSync(config.basePath, { recursive: true });
    }
  }
  ctx.plugin(ModelService, config);
  ctx.plugin(ExtensionService, config);
  if (config.enableChatTools) {
    ctx.plugin(ChatHistoryPlugin, {
      sessionsDir: resolve(ctx.baseDir, config.basePath, "sessions"),
      isolation: false,
      defaultLimit: 20,
      maxLimit: 50,
    });
  }
  ctx.plugin(CoreApp, config);
}

export * from "./internal/index.js";
