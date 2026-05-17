import type { UserContent } from "@yesimbot/agent/ai";
import type { Context } from "koishi";

import type {
  AthenaEvent,
  ChatMessageDetails,
  EventFormatter,
  FormatterContext,
  PlatformAdapter,
} from "./types.js";
import { createEvent } from "./types.js";

export class GenericAdapter implements PlatformAdapter {
  platform = "*"; // wildcard — handles all platforms without a dedicated adapter

  private _skipPlatforms = new Set<string>();

  /** Mark a platform as handled by a dedicated adapter — GenericAdapter will skip it. */
  addSkipPlatform(platform: string): void {
    this._skipPlatforms.add(platform);
  }

  removeSkipPlatform(platform: string): void {
    this._skipPlatforms.delete(platform);
  }

  install(ctx: Context, emit: (event: AthenaEvent) => void): void {
    ctx.middleware(async (session, next) => {
      // Skip if a dedicated adapter handles this platform
      if (this._skipPlatforms.has(session.platform!)) {
        return next();
      }

      const isMentioned =
        session.stripped?.atSelf ||
        session.elements?.some((el) => el.type === "at" && el.attrs.id === session.bot.selfId);

      const event = createEvent<"chat_message", ChatMessageDetails>("chat_message", {
        source: {
          platform: session.platform!,
          channelId: session.channelId!,
          conversationType: session.isDirect ? "private" : "group",
        },
        actor: {
          id: session.author?.id ?? session.userId!,
          name: session.author?.name ?? session.author?.nick,
          avatar: session.author?.avatar,
        },
        details: {
          messageId: session.messageId!,
          elements: session.elements ?? [],
          quoteMessageId: session.quote?.id,
          quoteSender: session.quote
            ? {
                id:
                  session.quote.user?.id ?? (session.quote as unknown as { userId: string }).userId,
                name:
                  session.quote.user?.name ??
                  (session.quote as unknown as { username?: string }).username,
              }
            : undefined,
        },
        meta: {
          persist: true,
          triggerCandidate: session.isDirect || !!isMentioned,
          rawRef: session,
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
  event: AthenaEvent<"chat_message", ChatMessageDetails>,
  ctx: FormatterContext,
): UserContent | null {
  const textParts = event.details.elements
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

  if (ctx.conversationType === "private") {
    return textParts;
  }
  return `${event.actor.name || event.actor.id} said: ${textParts}`;
}
