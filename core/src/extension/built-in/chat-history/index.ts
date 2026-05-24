import { Context, Logger, Service } from "koishi";

import { encodeChannelId } from "../../../services/session/encoding.js";
import type { ExtensionContext, ReloadSummary } from "../../types.js";
import { buildChatHistoryPrompt } from "./prompt.js";
import { createReadConversationContextTool } from "./tools/read-conversation-context.js";
import { createSearchConversationTool } from "./tools/search-conversation.js";
import { createSearchUserActivityTool } from "./tools/search-user-activity.js";
import type { ChatHistoryConfig } from "./types.js";

export type { ChatHistoryConfig };

function logReloadFailures(logger: Logger, action: string, summary: ReloadSummary): void {
  if (summary.allSucceeded) return;
  logger.warn(
    `${action} completed with ${summary.failureCount} failed channel reload(s): ${summary.results
      .filter((result) => !result.success)
      .map((result) => `${result.channelKey}: ${result.error ?? "unknown error"}`)
      .join("; ")}`,
  );
}

export class ChatHistoryPlugin extends Service<ChatHistoryConfig> {
  static name = "yesimbot.chat-history";
  static inject = ["yesimbot.extension"];

  readonly logger: Logger;

  constructor(ctx: Context, config: ChatHistoryConfig) {
    super(ctx, "yesimbot.chat-history");
    this.logger = ctx.logger("chat-history");
    this.config = config;
  }

  async start(): Promise<void> {
    const config = this.config;
    const summary = await this.ctx["yesimbot.extension"].registerExtension({
      id: "chat-history",
      setup(ctx: ExtensionContext) {
        const channel = ctx.channel;
        const currentChannel = {
          platform: channel.platform,
          channelId: channel.channelId,
          channelKey: encodeChannelId(channel.platform, channel.channelId),
        };

        ctx.on("agent:before-start", ((event: { systemPrompt: string }) => ({
          systemPrompt:
            event.systemPrompt +
            buildChatHistoryPrompt({
              isolation: config.isolation,
              currentChannel,
            }),
        })) as (...args: unknown[]) => unknown);

        const searchConv = createSearchConversationTool(config, currentChannel);
        const searchUser = createSearchUserActivityTool(config, currentChannel);
        const readCtx = createReadConversationContextTool(config, currentChannel);

        ctx.registerTool(searchConv);
        ctx.registerTool(searchUser);
        ctx.registerTool(readCtx);

        return {
          dispose() {},
        };
      },
    });
    logReloadFailures(this.logger, "Chat-history extension registration", summary);
  }

  async stop(): Promise<void> {
    const summary = await this.ctx["yesimbot.extension"].unregisterExtension("chat-history");
    logReloadFailures(this.logger, "Chat-history extension unregistration", summary);
    this.logger.info("Chat-history plugin stopped");
  }
}
