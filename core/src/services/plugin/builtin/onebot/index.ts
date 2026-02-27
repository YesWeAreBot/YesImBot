import { Context, h, Schema } from "koishi";

import type { FormatterService } from "../../../formatter/service";
import type { HorizonService } from "../../../horizon/service";
import { requireBotRole, requirePlatform, requireSession } from "../../activators";
import { Plugin } from "../../base-plugin";
import { Action, Metadata, withInnerThoughts } from "../../decorators";
import type { ToolExecutionContext, ToolResult } from "../../types";
import { Failed, Success } from "../../utils";
import { ForwordMessageResponse, Message } from "./types";

declare module "koishi" {
  interface Session {
    onebot: {
      _request<T>(action: string, params: Record<string, unknown>): Promise<T>;
    };
  }
}

@Metadata({ name: "onebot", description: "Onebot built-in tools", builtin: true })
export class OnebotPlugin extends Plugin {
  private pokeCooldowns = new Map<string, number>();
  private readonly POKE_COOLDOWN_MS = 60_000;

  constructor(private ctx: Context) {
    super();
  }

  private resolveNativeMsgId(ctx: ToolExecutionContext, shortIdStr: string): string | null {
    const shortId = Number(shortIdStr);
    if (!Number.isInteger(shortId) || shortId < 0) return null;
    const channelKey = `${ctx.platform}:${ctx.channelId}`;
    const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
    return horizon.lookupNativeMsgId(channelKey, shortId) ?? null;
  }

  @Action({
    name: "reaction_create",
    description:
      "Add an emoji reaction to a message using a QQ face ID. Only works in group chats. " +
      "Use the short message ID from <msg id=...> tags. Face IDs are platform-native numbers (e.g. 178 for thumbs up).",
    parameters: withInnerThoughts({
      message_id: Schema.string().required().description("Short message ID from <msg id=...> tag"),
      face_id: Schema.number().required().description("QQ face ID number"),
    }),
    activators: [requireSession(), requirePlatform("onebot")],
    hidden: true,
  })
  async reactionCreate(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const session = ctx.session;
      if (!session) return Failed("No active session");
      if (!session.guildId) return Failed("Reactions are only available in group chats");

      const messageIdStr = String(params["message_id"] ?? "");
      if (!messageIdStr) return Failed("message_id is required");

      const faceId = Number(params["face_id"]);
      if (!Number.isInteger(faceId) || faceId < 0)
        return Failed("face_id must be a non-negative integer");

      const nativeMsgId = this.resolveNativeMsgId(ctx, messageIdStr);
      if (!nativeMsgId) return Failed("Message not found in current context");

      await session.onebot._request("set_msg_emoji_like", {
        message_id: nativeMsgId,
        emoji_id: String(faceId),
      });
      return Success("Reaction added");
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  @Action({
    name: "essence_create",
    description:
      "Set a message as a group highlight (essence/精华). Use for particularly valuable, funny, or memorable messages. " +
      "Use the short message ID from <msg id=...> tags. Requires bot admin role.",
    parameters: withInnerThoughts({
      message_id: Schema.string().required().description("Short message ID from <msg id=...> tag"),
    }),
    activators: [requireSession(), requirePlatform("onebot"), requireBotRole("admin")],
    hidden: true,
  })
  async essenceCreate(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const session = ctx.session;
      if (!session) return Failed("No active session");
      if (!session.guildId) return Failed("Essence is only available in group chats");

      const messageIdStr = String(params["message_id"] ?? "");
      if (!messageIdStr) return Failed("message_id is required");

      const nativeMsgId = this.resolveNativeMsgId(ctx, messageIdStr);
      if (!nativeMsgId) return Failed("Message not found in current context");

      await session.onebot._request("set_essence_msg", { message_id: nativeMsgId });
      return Success("Message set as group highlight");
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  @Action({
    name: "essence_delete",
    description:
      "Remove a message from group highlights (essence/精华). " +
      "Use the short message ID from <msg id=...> tags. Requires bot admin role.",
    parameters: withInnerThoughts({
      message_id: Schema.string().required().description("Short message ID from <msg id=...> tag"),
    }),
    activators: [requireSession(), requirePlatform("onebot"), requireBotRole("admin")],
    hidden: true,
  })
  async essenceDelete(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const session = ctx.session;
      if (!session) return Failed("No active session");
      if (!session.guildId) return Failed("Essence is only available in group chats");

      const messageIdStr = String(params["message_id"] ?? "");
      if (!messageIdStr) return Failed("message_id is required");

      const nativeMsgId = this.resolveNativeMsgId(ctx, messageIdStr);
      if (!nativeMsgId) return Failed("Message not found in current context");

      await session.onebot._request("delete_essence_msg", { message_id: nativeMsgId });
      return Success("Message removed from group highlights");
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  @Action({
    name: "send_poke",
    description:
      "Send a poke/nudge to a user. Use sparingly as a playful interaction. " +
      "In group chats, pokes the user within the group. In private chats, sends a direct poke. " +
      "Has a per-user cooldown to prevent spam.",
    parameters: withInnerThoughts({
      target_user_id: Schema.string().required().description("Platform user ID of the target user"),
    }),
    activators: [requireSession(), requirePlatform("onebot")],
    hidden: true,
  })
  async sendPoke(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    try {
      const session = ctx.session;
      if (!session) return Failed("No active session");

      const targetUserId = String(params["target_user_id"] ?? "");
      if (!targetUserId) return Failed("target_user_id is required");

      const cooldownKey = `${ctx.platform}:${ctx.channelId}:${targetUserId}`;
      const now = Date.now();
      const lastPoke = this.pokeCooldowns.get(cooldownKey) ?? 0;
      if (now - lastPoke < this.POKE_COOLDOWN_MS) {
        const remaining = Math.ceil((this.POKE_COOLDOWN_MS - (now - lastPoke)) / 1000);
        return Failed(`Poke cooldown active for this user (${remaining}s remaining)`);
      }

      const pokeParams: Record<string, unknown> = { user_id: targetUserId };
      if (session.guildId) {
        pokeParams.group_id = session.guildId;
      }

      await session.onebot._request("send_poke", pokeParams);
      this.pokeCooldowns.set(cooldownKey, now);
      return Success("Poke sent");
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  @Action({
    name: "get_forward_msg",
    description:
      "Read the contents of a forwarded message bundle. Returns a plain text summary of the messages. " +
      "Use the forward ID from <forward id=...> tags in the context.",
    parameters: withInnerThoughts({
      message_id: Schema.string()
        .required()
        .description("Forward message ID from <forward id=...> tag"),
    }),
    activators: [requireSession(), requirePlatform("onebot")],
    hidden: true,
  })
  async getForwardMessage(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const messageId = String(params["message_id"] ?? "");
      const session = ctx.session;
      if (!session) return Failed("No active session");
      if (!messageId) return Failed("message_id is required");

      const response: ForwordMessageResponse = await session.onebot._request("get_forward_msg", {
        message_id: messageId,
      });

      const allMessages = response.data.messages;
      const MAX_FORWARD_MESSAGES = 10;
      const messages = allMessages.slice(0, MAX_FORWARD_MESSAGES);
      const truncated = allMessages.length > MAX_FORWARD_MESSAGES;

      const formatted = this.formatForwardMessages(messages);
      const suffix = truncated
        ? `\n\n[Showing ${MAX_FORWARD_MESSAGES} of ${allMessages.length} messages]`
        : "";
      return Success(formatted + suffix);
    } catch (e) {
      return Failed(e instanceof Error ? e.message : String(e));
    }
  }

  private formatForwardMessages(messages: Message[]): string {
    const formatter = this.ctx["yesimbot.formatter"] as FormatterService | undefined;

    return messages
      .map((msg) => {
        const sender = `Sender: ${msg.sender.nickname || msg.sender.card || String(msg.sender.user_id)}`;
        const time = `Time: ${new Date(msg.time * 1000).toLocaleString()}`;

        let content: string;
        if (formatter && msg.message?.length) {
          const elements = msg.message.map((seg) => h(seg.type, seg.data));
          content = formatter.format(elements);
        } else {
          content = msg.raw_message;
        }

        return `${sender}\n${time}\nContent: ${content}`;
      })
      .join("\n\n---\n\n");
  }
}
