import { UserContent } from "@yesimbot/agent/ai";
import { h } from "koishi";

import {
  AthenaEvent,
  ChatMessageDetails,
  EventFormatter,
  FormatterContext,
  PlatformAdapter,
} from "../types";
import { createEvent } from "../types";

export interface OneBotConfig {
  logLevel?: number;
}

export class OneBotAdapter extends PlatformAdapter<OneBotConfig> {
  platform = "onebot";
  install(emit: (event: AthenaEvent) => void): void {
    const logger = this.ctx.logger("OneBotAdapter");
    logger.level = this.config?.logLevel ?? 2;
    this.ctx.platform("onebot").on("message", async (session) => {
      logger.debug(
        `Message Event | type=${session.type}, id=${session.messageId}, author=${session.author?.id}, channel=${session.channelId}, content=${session.content}`,
      );
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
          isSelf: session.author?.id === session.bot.selfId,
        },
        details: {
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
        meta: {
          persist: true,
          triggerCandidate: session.isDirect || !!isMentioned,
          bot: session.bot,
          raw: session,
        },
      });

      emit(event);
    });
  }
  formatters = {
    chat_message: formatChatMessage as EventFormatter,
  };
}

function formatChatMessage(
  event: AthenaEvent<"chat_message", ChatMessageDetails>,
  ctx: FormatterContext,
): UserContent | null {
  const elements = h.parse(event.details.content);
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
