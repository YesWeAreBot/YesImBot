import type { Session } from "koishi";
import { Context, Logger, h } from "koishi";

import { formatQuotePrefix, wrapIfLong } from "../formatter/handlers";
import { TriggerType } from "../shared/types";
import type { EventManager } from "./manager";
import type { HorizonServiceConfig } from "./service";
import { TimelineStage } from "./types";

// Table name constant — schema declared in horizon service (Plan 03)
const ENTITY_TABLE = "yesimbot.entity";

export class EventListener {
  private logger: Logger;
  private disposers: (() => void)[] = [];
  private lastEntityUpdate = new Map<string, number>();

  constructor(
    private ctx: Context,
    private events: EventManager,
    private config: HorizonServiceConfig,
  ) {
    this.logger = ctx.logger("horizon");
  }

  start(): void {
    this.disposers.push(
      this.ctx.middleware(async (session, next) => {
        if (!this.isChannelAllowed(session)) return next();
        if (session.author?.isBot) return next();
        const formattedContent = await this.recordUserMessage(session);
        await next();
        this.ctx.emit("horizon/message", {
          platform: session.platform,
          channelId: session.channelId ?? "",
          timestamp: new Date(session.timestamp),
          payload: {
            messageId: session.messageId ?? "",
            senderId: session.author?.id ?? session.userId ?? "",
            senderName: session.author?.nick || session.author?.name || session.userId || "",
            content: formattedContent,
          },
          triggerType: this.classifyTrigger(session),
          runtime: { session },
        });
      }),
    );
  }

  stop(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
  }

  private isChannelAllowed(session: Session): boolean {
    return this.config.allowedChannels.some((ch) => {
      if (ch.platform !== session.platform) return false;
      const isPrivate = session.isDirect;
      if (ch.type === "private" && !isPrivate) return false;
      if (ch.type === "guild" && isPrivate) return false;
      if (ch.id === "*") return true;
      return ch.id === (isPrivate ? session.userId : session.channelId);
    });
  }

  private classifyTrigger(session: Session): TriggerType {
    if (session.isDirect) return "direct";
    if (session.quote?.user?.id === session.bot.selfId) return "reply";
    if (session.elements?.some((el) => el.type === "at" && el.attrs?.id === session.selfId))
      return "mention";
    if (this.config.keywords?.some((kw) => session.content?.includes(kw))) return "keyword";
    return "random";
  }

  private async recordUserMessage(session: Session): Promise<string> {
    this.logger.info(
      `user message | ${session.author?.name} | ${session.cid} | ${session.content}`,
    );
    if (session.guildId) {
      await this.updateMemberInfo(session, `guild:${session.guildId}`);
    } else if (session.isDirect) {
      await this.updateMemberInfo(session, `direct:${session.platform}`);
    }

    // Format elements through ElementFormatterService
    const formatter = this.ctx["yesimbot.formatter"];
    const elements = session.elements?.length ? session.elements : h.parse(session.content ?? "");
    let formattedContent = formatter.format(elements, session);

    // Prepend quote prefix if replying
    const quotePrefix = formatQuotePrefix(session);
    if (quotePrefix) {
      formattedContent = quotePrefix + " " + formattedContent;
    }

    // Wrap long messages with <unverified> tag
    formattedContent = wrapIfLong(formattedContent);

    await this.events.recordMessage({
      platform: session.platform,
      channelId: session.channelId ?? "",
      stage: TimelineStage.New,
      timestamp: new Date(session.timestamp),
      data: {
        messageId: session.messageId ?? "",
        senderId: session.author?.id ?? session.userId ?? "",
        senderName: session.author?.nick || session.author?.name || session.userId || "",
        content: formattedContent,
        replyTo: session.quote?.id,
      },
    });

    return formattedContent;
  }

  private async recordBotSentMessage(session: Session): Promise<void> {
    if (!session.content || !session.messageId) return;
    await this.events.recordMessage({
      platform: session.platform,
      channelId: session.channelId ?? "",
      stage: TimelineStage.Active,
      timestamp: new Date(session.timestamp),
      data: {
        messageId: session.messageId,
        senderId: session.bot.selfId ?? "",
        senderName: session.bot.user?.name ?? session.bot.selfId ?? "",
        content: session.content,
      },
    });
  }

  private async updateMemberInfo(session: Session, parentId: string): Promise<void> {
    if (!session.author) return;
    const id = `${session.platform}:${session.author.id}@${parentId}`;
    const now = Date.now();
    const last = this.lastEntityUpdate.get(id);
    if (last && now - last < 60000) return;
    this.lastEntityUpdate.set(id, now);
    try {
      await this.ctx.database.upsert(ENTITY_TABLE, [
        {
          id,
          type: "member",
          name: session.author.nick || session.author.name || "",
          parentId,
          attributes: {
            roles: session.author.roles ?? [],
            platform: session.platform,
            avatar: session.author.avatar,
            lastActive: new Date(),
          },
          updatedAt: new Date(),
        },
      ]);
    } catch (err: unknown) {
      this.logger.error(`updateMemberInfo failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
