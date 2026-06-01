import { Context, Logger, Schema } from "koishi";
import type { Internal } from "koishi-plugin-adapter-onebot/lib/types";
import type { ExtensionContext } from "koishi-plugin-yesimbot";
import { z } from "zod";

import { ForwardMessage } from "./types.js";

export interface OnebotUtilsConfig {}

export default class OnebotUtilsPlugin {
  static name = "yesimbot-onebot-utils";
  static inject = ["yesimbot.extension"];
  static Config: Schema<OnebotUtilsConfig> = Schema.object({});

  public readonly ctx: Context;
  public readonly config: OnebotUtilsConfig;
  public readonly logger: Logger;

  constructor(ctx: Context, config: OnebotUtilsConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.onebot-utils");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    const logger = this.logger;
    await this.ctx["yesimbot.extension"].registerExtension({
      id: "onebot-utils",
      setup(ctx: ExtensionContext) {
        if (ctx.channel.platform !== "onebot") return;
        ctx.on("agent:before-start", async (event) => {});
        ctx.tool.register({
          name: "onebot_get_message_id",
          description: "获取消息 ID",
          inputSchema: z.object({
            message: z.string().describe("要获取 ID 的消息"),
          }),
          execute: async (input) => {
            if (!ctx.platform.bot?.internal) {
              throw new Error("当前频道的机器人适配器不支持 OneBot 协议");
            }
            const internal = ctx.platform.bot.internal as Internal;
            const { message } = input;
          },
        });

        ctx.tool.register({
          name: "onebot_get_forward_message",
          description: "获取合并转发消息的原始消息列表",
          inputSchema: z.object({
            messageId: z.string().describe("合并转发消息的 ID"),
          }),
          execute: async (input) => {
            if (!ctx.platform.bot?.internal) {
              throw new Error("当前频道的机器人适配器不支持 OneBot 协议");
            }
            const internal = ctx.platform.bot.internal as Internal;
            const { messageId } = input;
            const forwardMsg = (await internal.getForwardMsg(
              messageId,
            )) as unknown as ForwardMessage[];
            return forwardMsg;
          },
        });

        ctx.tool.register({
          name: "onebot_create_reaction",
          description: "对消息进行表态",
          inputSchema: z.object({
            messageId: z.string().describe("要表态的消息 ID"),
            emojiId: z.string().describe("表情 ID"),
          }),
          execute: async (input) => {
            if (!ctx.platform.bot?.internal) {
              throw new Error("当前频道的机器人适配器不支持 OneBot 协议");
            }
            const internal = ctx.platform.bot.internal as Internal;
            if (!internal._request) {
              throw new Error("当前频道的机器人适配器不支持发送 OneBot 请求");
            }

            const { messageId, emojiId } = input;
            const result = await internal._request("set_msg_emoji_like", {
              message_id: messageId,
              emoji_id: emojiId,
            });
            return result;
          },
        });

        ctx.tool.register({
          name: "onebot_set_essence",
          description: "将消息设置为精华",
          inputSchema: z.object({
            messageId: z.string().describe("要设置为精华的消息 ID"),
          }),
          execute: async (input) => {
            if (!ctx.platform.bot?.internal) {
              throw new Error("当前频道的机器人适配器不支持 OneBot 协议");
            }
            const internal = ctx.platform.bot.internal as Internal;

            const { messageId } = input;
            const result = await internal.setEssenceMsg(messageId);
            return { success: true };
          },
        });
      },
    });
  }

  async stop(): Promise<void> {
    await this.ctx["yesimbot.extension"].unregisterExtension("onebot-utils");
  }
}
