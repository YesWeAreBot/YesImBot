import {
  Action,
  Failed,
  Metadata,
  Plugin,
  requireSession,
  Success,
  ToolExecutionContext,
  ToolResult,
  withInnerThoughts,
} from "@yesimbot/plugin";
import { Context, Schema, sleep } from "koishi";

@Metadata({ name: "core", description: "Core built-in tools", builtin: true })
export class CorePlugin extends Plugin {
  constructor(private ctx: Context) {
    super();
  }

  @Action({
    name: "send_message",
    description:
      "Sends a message to the channel. This is the only way you can talk to the human user.",
    parameters: withInnerThoughts({
      content: Schema.string()
        .required()
        .description(
          "Message content to send. Use `<sep/>` to split a long message into multiple parts (natural delays).",
        ),
      target: Schema.object({
        platform: Schema.string().required().description("Target platform (e.g., 'discord')"),
        channelId: Schema.string().required().description("Target channel ID"),
      }).description(
        "Optional target to specify which channel to send the message to. If not provided, it will send to the current session's channel.",
      ),
    }),
    activators: [requireSession()],
  })
  async sendMessage(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const content = String(params["content"] ?? "");
      const target = params["target"] as { platform: string; channelId: string } | undefined;
      const parts = content
        .split("<sep/>")
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveParts = parts.length ? parts : [content];

      if (target) {
        const { platform, channelId } = target;
        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) return Failed(`Bot not found for platform: ${platform}`);
        for (let i = 0; i < effectiveParts.length; i++) {
          if (i > 0) await sleep(1000);
          await bot.sendMessage(channelId, effectiveParts[i]!);
        }
      } else {
        for (let i = 0; i < effectiveParts.length; i++) {
          if (i > 0) await sleep(1000);
          await ctx.session?.send(effectiveParts[i]);
        }
      }
      return Success(`Sent ${effectiveParts.length} message(s)`);
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }
}
