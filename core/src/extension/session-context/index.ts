import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI } from "@yesimbot/agent/session";
import { Context, Logger, Service } from "koishi";

import { AthenaExtensionDefinition, ChannelContext } from "../../extension.js";
import { encodeChannelId } from "../../services/session/encoding.js";
import { buildSessionContextPrompt } from "./prompt.js";
import {
  createFindChannelsTool,
  createListSessionsTool,
  createReadSessionWindowTool,
  createSearchSessionTool,
} from "./tools.js";
import { SessionContextConfig } from "./types.js";

export function createSessionContextExtension(
  ctx: Context,
  config: SessionContextConfig,
): AthenaExtensionDefinition {
  const sessionsDir = resolve(ctx.baseDir, config.sessionsDir);
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  return {
    id: "session-context",
    setup(api: ExtensionAPI, context?: ChannelContext) {
      const currentChannel = context
        ? {
            platform: context.platform,
            channelId: context.channelId,
            channelKey: encodeChannelId(context.platform, context.channelId),
          }
        : null;

      api.on("agent:before-start", (event) => ({
        systemPrompt:
          event.systemPrompt +
          buildSessionContextPrompt({
            isolation: config.isolation,
            currentChannel,
            defaultLimit: config.defaultLimit,
            maxLimit: config.maxLimit,
          }),
      }));

      api.registerTool(createFindChannelsTool(config, currentChannel));
      api.registerTool(createSearchSessionTool(config, currentChannel));
      api.registerTool(createListSessionsTool(config, currentChannel));
      api.registerTool(createReadSessionWindowTool(config, currentChannel));

      return {
        dispose() {},
      };
    },
  };
}

export class SessionContextPlugin extends Service<SessionContextConfig> {
  static name = "yesimbot.session-context";
  static inject = ["yesimbot.extension"];

  readonly logger: Logger;

  constructor(ctx: Context, config: SessionContextConfig) {
    super(ctx, "yesimbot.session-context");
    this.logger = ctx.logger("session-context");
    this.config = config;
  }

  async start(): Promise<void> {
    this.logger.info("Starting session-context plugin...");

    this.logger.success("Session-context plugin started");
  }

  async stop(): Promise<void> {
    this.ctx["yesimbot.extension"].unregisterExtension("session-context");
    this.logger.info("Session-context plugin stopped");
  }
}
