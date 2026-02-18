import { Context, Schema } from "koishi";

import { Plugin } from "../base-plugin";
import { Action, Metadata, withInnerThoughts } from "../decorators";
import type { FunctionContext, ToolResult } from "../types";
import { Failed, Success } from "../utils";

@Metadata({ name: "core", description: "Core built-in tools", builtin: true })
export class CorePlugin extends Plugin {
  constructor(private ctx: Context) {
    super();
  }

  @Action({
    name: "send_message",
    description: "Send a message to the current conversation",
    parameters: withInnerThoughts({
      content: Schema.string().required().description("Message content to send"),
      target: Schema.string().description(
        "Target channel in platform:channelId format. Defaults to current channel.",
      ),
    }),
  })
  async sendMessage(params: Record<string, unknown>, ctx: FunctionContext): Promise<ToolResult> {
    try {
      const content = String(params["content"] ?? "");
      const target = params["target"] as string | undefined;
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveParts = parts.length ? parts : [content];

      if (target) {
        const colonIdx = target.indexOf(":");
        const platform = target.slice(0, colonIdx);
        const channelId = target.slice(colonIdx + 1);
        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) return Failed(`Bot not found for platform: ${platform}`);
        for (const part of effectiveParts) await bot.sendMessage(channelId, part);
      } else {
        for (const part of effectiveParts) await ctx.session?.send(part);
      }
      return Success();
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }
}
