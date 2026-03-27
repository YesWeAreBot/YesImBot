import { Context, Service, type Session as KoishiSession } from "koishi";

import type { ChannelEvent } from "../session/types";
import type { ListenerConfig } from "./types";

declare module "koishi" {
  interface Context {
    "athena.listener": ListenerService;
  }
}

export class ListenerService extends Service<ListenerConfig> {
  static inject = ["athena.session"];

  private disposeListener: (() => void) | null = null;

  constructor(ctx: Context, config: ListenerConfig) {
    super(ctx, "athena.listener", false);
    this.config = config;
    this.logger = ctx.logger("athena.listener");
    this.logger.level = config.debugLevel ?? 2;
  }

  async start(): Promise<void> {
    this.disposeListener = this.ctx.middleware(async (koishiSession, next) => {
      await this.handleMessage(koishiSession);
      return next();
    });
  }

  async dispose(): Promise<void> {
    this.disposeListener?.();
    this.disposeListener = null;
  }

  private async handleMessage(koishiSession: KoishiSession): Promise<void> {
    const platform = koishiSession.platform;
    const channelId = koishiSession.channelId;
    const userId = koishiSession.userId;
    const username = koishiSession.username ?? koishiSession.userId;
    const content = koishiSession.content ?? "";
    const isDirect = koishiSession.isDirect ?? false;
    const atSelf =
      koishiSession.stripped.atSelf ||
      (koishiSession.stripped.hasAt &&
        koishiSession.elements?.some(
          (el) => el.type === "at" && el.attrs.id === koishiSession.selfId,
        )) ||
      false;
    const messageId = koishiSession.messageId ?? "";
    const timestamp = koishiSession.timestamp ?? Date.now();
    const isReplyToBot = koishiSession.quote?.user?.id === koishiSession.selfId;
    const elements = koishiSession.elements ?? [];
    const bot = koishiSession.bot;

    if (!platform || !channelId || !userId || !koishiSession.selfId) {
      this.logger.debug("skipped message due to missing required session fields");
      return;
    }

    const event: ChannelEvent = {
      platform,
      channelId,
      userId,
      username,
      content,
      isDirect,
      atSelf,
      isReplyToBot,
      messageId,
      timestamp,
      elements,
      bot,
    };

    await this.ctx["athena.session"].receive(event);
  }
}
