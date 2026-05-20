import { h } from "koishi";

import {
  AthenaEvent,
  ChatMessagePayload,
  PlatformAdapter,
  SubmitMessageInput,
  SubmitMessageResult,
} from "../types";
import { createEvent } from "../types";

export interface OneBotConfig {
  logLevel?: number;
}

export class OneBotAdapter extends PlatformAdapter<OneBotConfig> {
  platform = "onebot";

  async submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    try {
      await input.bot.sendMessage(input.channelId, input.text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

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
    });
  }
}
