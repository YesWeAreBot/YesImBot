import { Context, h, Schema } from "koishi";

import type { FormatterService } from "../../../formatter/service";
import type { HorizonService } from "../../../horizon/service";
import { requireSession, requirePlatform, requireBotRole } from "../../activators";
import { Action, Metadata, withInnerThoughts } from "../../decorators";
import { YesImPlugin } from "../../plugin";
import { ToolExecutionContext, ToolResult } from "../../types";
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
export class OnebotPlugin extends YesImPlugin {
  private pokeCooldowns = new Map<string, number>();
  private readonly POKE_COOLDOWN_MS = 60_000;

  constructor(ctx: Context) {
    super(ctx);
  }

  private resolveNativeMsgId(ctx: ToolExecutionContext, shortIdStr: string): string | null {
    const shortId = Number(shortIdStr);
    if (!Number.isInteger(shortId) || shortId < 0) return null;
    const channelKey = `${ctx.platform}:${ctx.channelId}`;
    const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
    return horizon.lookupNativeMsgId(channelKey, shortId) ?? null;
  }

  private getEntityRole(ctx: ToolExecutionContext, userId: string): "owner" | "admin" | null {
    const entities = ctx["entities"] as
      | Array<{
          userId?: string;
          attributes?: Record<string, unknown>;
        }>
      | undefined;
    if (!entities) return null;
    const entity = entities.find((e) => e.userId === userId);
    if (!entity?.attributes?.roles) return null;
    const roles = entity.attributes.roles as string[];
    if (roles.some((r) => /^owner$/i.test(r))) return "owner";
    if (roles.some((r) => /^(admin|administrator|moderator)$/i.test(r))) return "admin";
    return null;
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

  @Action({
    name: "delmsg",
    description: "撤回指定消息。传入消息短 ID 列表，支持批量撤回。",
    parameters: withInnerThoughts({
      message_ids: Schema.array(Schema.string())
        .required()
        .description("要撤回的消息短 ID 列表（来自 <msg id=...> 标签）"),
    }),
    activators: [requireSession(), requireBotRole("admin")],
    hidden: true,
  })
  async delmsg(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const session = ctx.session;
    if (!session) return Failed("无活跃会话");
    if (!session.guildId) return Failed("撤回消息仅在群聊中可用");

    const rawIds = params["message_ids"];
    const ids = Array.isArray(rawIds) ? rawIds.map(String) : [String(rawIds ?? "")];
    if (!ids.length || ids.every((id) => !id)) return Failed("message_ids 不能为空");

    const MAX_BATCH = 10;
    const batch = ids.slice(0, MAX_BATCH);

    const channelId = session.channelId ?? ctx.channelId;
    const errors: string[] = [];
    let successCount = 0;

    for (const shortIdStr of batch) {
      const nativeId = this.resolveNativeMsgId(ctx, shortIdStr);
      if (!nativeId) {
        errors.push(`消息 ${shortIdStr} 不在当前上下文中`);
        continue;
      }
      try {
        await session.bot.deleteMessage(channelId, nativeId);
        successCount++;
      } catch (e) {
        errors.push(`撤回消息 ${shortIdStr} 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (ids.length > MAX_BATCH) {
      errors.push(`仅处理前 ${MAX_BATCH} 条（共 ${ids.length} 条）`);
    }

    if (errors.length === 0) return Success(`已撤回 ${successCount} 条消息`);
    if (successCount === 0) return Failed(errors.join("；"));
    return Success(`已撤回 ${successCount} 条消息，${errors.length} 条失败：${errors.join("；")}`);
  }

  @Action({
    name: "ban",
    description: "禁言用户。duration 为禁言时长（秒），0 表示解除禁言。",
    parameters: withInnerThoughts({
      user_id: Schema.string().required().description("目标用户的平台 ID"),
      duration: Schema.number().required().description("禁言时长（秒），0 = 解除禁言"),
    }),
    activators: [requireSession(), requireBotRole("admin")],
    hidden: true,
  })
  async ban(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const session = ctx.session;
    if (!session) return Failed("无活跃会话");
    if (!session.guildId) return Failed("禁言仅在群聊中可用");

    const userId = String(params["user_id"] ?? "");
    if (!userId) return Failed("user_id 不能为空");

    const duration = Number(params["duration"]);
    if (!Number.isFinite(duration) || duration < 0) return Failed("duration 必须为非负数");

    // Safety intercept: block operating on bot self
    if (userId === session.bot.selfId) return Failed("禁言失败：不能对 bot 自身执行此操作");

    // Safety intercept: block operating on admin/owner
    const targetRole = this.getEntityRole(ctx, userId);
    if (targetRole === "admin" || targetRole === "owner") {
      return Failed("禁言失败：目标用户是管理员或群主");
    }

    try {
      await session.bot.muteGuildMember(session.guildId, userId, duration * 1000);
      if (duration === 0) return Success(`已解除用户 ${userId} 的禁言`);
      const minutes = Math.round(duration / 60);
      return Success(
        minutes > 0
          ? `已禁言用户 ${userId} ${minutes} 分钟`
          : `已禁言用户 ${userId} ${duration} 秒`,
      );
    } catch (e) {
      return Failed(`禁言失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @Action({
    name: "kick",
    description: "将用户移出群组。",
    parameters: withInnerThoughts({
      user_id: Schema.string().required().description("目标用户的平台 ID"),
    }),
    activators: [requireSession(), requireBotRole("admin")],
    hidden: true,
  })
  async kick(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const session = ctx.session;
    if (!session) return Failed("无活跃会话");
    if (!session.guildId) return Failed("踢人仅在群聊中可用");

    const userId = String(params["user_id"] ?? "");
    if (!userId) return Failed("user_id 不能为空");

    // Safety intercept: block operating on bot self
    if (userId === session.bot.selfId) return Failed("踢人失败：不能对 bot 自身执行此操作");

    // Safety intercept: block operating on admin/owner
    const targetRole = this.getEntityRole(ctx, userId);
    if (targetRole === "admin" || targetRole === "owner") {
      return Failed("踢人失败：目标用户是管理员或群主");
    }

    try {
      await session.bot.kickGuildMember(session.guildId, userId);
      return Success(`已将用户 ${userId} 移出群组`);
    } catch (e) {
      return Failed(`踢人失败：${e instanceof Error ? e.message : String(e)}`);
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
