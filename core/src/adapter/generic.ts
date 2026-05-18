import type { UserContent } from "@yesimbot/agent/ai";
import { h } from "koishi";

import type { AthenaEvent, ChatMessagePayload, EventFormatter, FormatterContext } from "./types.js";
import { createEvent, PlatformAdapter } from "./types.js";

export class GenericAdapter extends PlatformAdapter {
  platform = "*"; // wildcard — handles all platforms without a dedicated adapter

  private _skipPlatforms = new Set<string>();

  /** Mark a platform as handled by a dedicated adapter — GenericAdapter will skip it. */
  addSkipPlatform(platform: string): void {
    this._skipPlatforms.add(platform);
  }

  removeSkipPlatform(platform: string): void {
    this._skipPlatforms.delete(platform);
  }

  install(emit: (event: AthenaEvent) => void): void {
    this.ctx.middleware(async (session, next) => {
      // Skip if a dedicated adapter handles this platform
      if (this._skipPlatforms.has(session.platform!)) {
        return next();
      }

      const isMentioned =
        session.stripped?.atSelf ||
        session.elements?.some((el) => el.type === "at" && el.attrs.id === session.bot.selfId);

      const event = createEvent<"chat_message", ChatMessagePayload>("chat_message", {
        source: {
          platform: session.platform!,
          channelId: session.channelId!,
          conversationType: session.isDirect ? "private" : "group",
        },
        actor: {
          id: session.author?.id ?? session.userId!,
          name: session.author?.name ?? session.author?.nick,
          avatar: session.author?.avatar,
          isSelf: session.author?.id === session.bot.selfId,
        },
        payload: {
          messageId: session.messageId!,
          content: session.content ?? "",
          quoteMessageId: session.quote?.id,
          quoteSender: session.quote
            ? {
                id: session.quote.user!.id,
                name: session.quote.user?.name ?? session.quote.user?.nick,
              }
            : undefined,
        },
        metadata: {
          persist: true,
          triggerCandidate: session.isDirect || !!isMentioned,
          bot: session.bot,
          raw: session,
        },
      });

      emit(event);
      return next();
    });
  }

  formatters: Record<string, EventFormatter> = {
    chat_message: formatChatMessageDefault as EventFormatter,
  };
}

function formatChatMessageDefault(
  event: AthenaEvent<"chat_message", ChatMessagePayload>,
  ctx: FormatterContext,
): UserContent | null {
  const elements = h.parse(event.payload.content);
  const textParts = elements
    .map((el) => {
      switch (el.type) {
        case "text":
          return el.attrs.content ?? "";
        case "at":
          return `@${el.attrs.name || el.attrs.id}`;
        case "img":
          return "[图片]";
        case "audio":
          return "[语音]";
        case "file":
          return `[文件]`;
        case "face":
          return el.attrs.name ? `[${el.attrs.name}]` : "[表情]";
        default:
          return "";
      }
    })
    .join("");

  if (!textParts) return null;

  const date = new Date(event.timestamp);
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const timeStr = fmt.format(date);
  const prefix = `[${timeStr}]`;

  if (ctx.conversationType === "private") {
    return textParts;
  }
  const sender = `${event.actor.name || "未知用户"} (${event.actor.id})`;
  return `${prefix} ${sender}: ${textParts}`;
}
