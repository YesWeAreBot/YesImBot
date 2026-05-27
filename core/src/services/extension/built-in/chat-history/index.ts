import { Context, Logger, Service } from "koishi";

import type { ExtensionContext } from "../../../../internal/extension/types.js";
import { encodeChannelId } from "../../../../internal/session/encoding.js";
import { buildChatHistoryPrompt } from "./prompt.js";
import { createReadConversationContextTool } from "./tools/read-conversation-context.js";
import { createSearchConversationTool } from "./tools/search-conversation.js";
import { createSearchUserActivityTool } from "./tools/search-user-activity.js";
import type { ChatHistoryConfig } from "./types.js";

export type { ChatHistoryConfig };

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
    await this.ctx["yesimbot.extension"].registerExtension({
      id: "chat-history",
      setup(ctx: ExtensionContext) {
        const channel = ctx.channel;
        const currentChannel = {
          platform: channel.platform,
          channelId: channel.channelId,
          channelKey: encodeChannelId(channel.platform, channel.channelId),
        };

        ctx.on("agent:before-start", (event) => ({
          systemPrompt:
            event.systemPrompt +
            buildChatHistoryPrompt({
              isolation: config.isolation,
              currentChannel,
            }),
        }));

        const searchConv = createSearchConversationTool(config, currentChannel);
        const searchUser = createSearchUserActivityTool(config, currentChannel);
        const readCtx = createReadConversationContextTool(config, currentChannel);

        ctx.tool.register(searchConv);
        ctx.tool.register(searchUser);
        ctx.tool.register(readCtx);

        return {
          dispose() {},
        };
      },
    });
    this.logger.info("Chat-history plugin started");
  }

  async stop(): Promise<void> {
    await this.ctx["yesimbot.extension"].unregisterExtension("chat-history");
    this.logger.info("Chat-history plugin stopped");
  }
}
