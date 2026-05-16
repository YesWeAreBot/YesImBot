import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI, ToolDefinition } from "@yesimbot/agent/session";
import { Context, Logger, Schema, Service } from "koishi";
import type { AthenaExtensionDefinition, ChannelContext } from "koishi-plugin-yesimbot";
import { encodeChannelId } from "koishi-plugin-yesimbot";

import { buildSessionContextPrompt } from "./prompt.js";
import {
  createFindChannelsTool,
  createListSessionsTool,
  createReadSessionWindowTool,
  createSearchSessionTool,
} from "./tools.js";
import type { SessionContextConfig } from "./types.js";

export interface SessionContextPluginConfig {
  sessionsDir: string;
  isolation: boolean;
  defaultLimit: number;
  maxLimit: number;
}

export default class SessionContextPlugin extends Service<SessionContextPluginConfig> {
  static name = "yesimbot.session-context";
  static inject = ["yesimbot.extension"];

  static Config: Schema<SessionContextPluginConfig> = Schema.object({
    sessionsDir: Schema.path({ filters: ["directory"], allowCreate: true })
      .default("data/yesimbot/sessions")
      .description("会话文件根目录（相对于 koishi app 目录）"),
    isolation: Schema.boolean().default(true).description("隔离模式：true 只允许访问当前频道"),
    defaultLimit: Schema.number().default(20).description("search_session 默认返回条数"),
    maxLimit: Schema.number().default(100).description("search_session 最大返回条数"),
  });

  readonly logger: Logger;

  constructor(ctx: Context, config: SessionContextPluginConfig) {
    super(ctx, "yesimbot.session-context");
    this.logger = ctx.logger("session-context");
    this.config = config;
  }

  async start(): Promise<void> {
    this.logger.info("Starting session-context plugin...");

    const sessionsDir = resolve(this.ctx.baseDir, this.config.sessionsDir);
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    const config: SessionContextConfig = {
      sessionsDir,
      isolation: this.config.isolation,
      defaultLimit: this.config.defaultLimit,
      maxLimit: this.config.maxLimit,
    };

    const logger = this.logger;

    this.ctx["yesimbot.extension"].registerExtension({
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

        logger.info("Registering session-context tools...");

        api.registerTool(createFindChannelsTool(config, currentChannel) as ToolDefinition);
        api.registerTool(createSearchSessionTool(config, currentChannel) as ToolDefinition);
        api.registerTool(createListSessionsTool(config, currentChannel) as ToolDefinition);
        api.registerTool(createReadSessionWindowTool(config, currentChannel) as ToolDefinition);

        return {
          dispose() {
            logger.info("Session-context extension disposed");
          },
        };
      },
    } as AthenaExtensionDefinition);

    this.logger.success("Session-context plugin started");
  }

  async stop(): Promise<void> {
    this.ctx["yesimbot.extension"].unregisterExtension("session-context");
    this.logger.info("Session-context plugin stopped");
  }
}
