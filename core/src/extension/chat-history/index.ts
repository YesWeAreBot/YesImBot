import type { ExtensionAPI } from "@yesimbot/agent/session";
import { Context, Logger, Service } from "koishi";

import { ChannelContext } from "../../extension.js";
import { encodeChannelId } from "../../services/session/encoding.js";
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
    this.ctx["yesimbot.extension"].registerExtension({
      id: "chat-history",
      setup(api: ExtensionAPI, context: ChannelContext) {
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
            buildChatHistoryPrompt({
              isolation: config.isolation,
              currentChannel,
            }),
        }));

        const searchConv = createSearchConversationTool(config, currentChannel);
        const searchUser = createSearchUserActivityTool(config, currentChannel);
        const readCtx = createReadConversationContextTool(config, currentChannel);

        api.registerTool(searchConv);
        api.registerTool(searchUser);
        api.registerTool(readCtx);

        return {
          dispose() {},
        };
      },
    });
  }

  async stop(): Promise<void> {
    this.ctx["yesimbot.extension"].unregisterExtension("chat-history");
    this.logger.info("Chat-history plugin stopped");
  }
}
