import type { Session } from "koishi";
import { Context, Logger, Random } from "koishi";

import type { EventManager } from "./manager";
import type { HorizonServiceConfig } from "./service";
import type { Percept, UserMessagePercept } from "./types";
import { PerceptType, TimelineStage } from "./types";

declare module "koishi" {
  interface Events {
    "horizon/percept": (percept: Percept) => void;
  }
}

// Table name constant — schema declared in horizon service (Plan 03)
const ENTITY_TABLE = "yesimbot.entity";

const TRIGGER_PRIORITY: Record<string, number> = {
  mention: 4,
  reply: 3,
  keyword: 2,
  direct: 1,
  random: 0,
};

interface PreceptTimer {
  clearTimer: ReturnType<typeof Context.prototype.setTimeout>;
  percept: UserMessagePercept;
}

export class EventListener {
  private logger: Logger;
  private disposers: (() => void)[] = [];
  private pendingPercepts = new Map<string, PreceptTimer>();
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
        await this.recordUserMessage(session);
        await next();
        const percept = this.buildPercept(session);
        const channelKey = `${session.platform}:${session.channelId}`;
        this.schedulePercept(channelKey, percept);
      }),
    );
  }

  stop(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    for (const { clearTimer } of this.pendingPercepts.values()) {
      clearTimer();
    }
    this.pendingPercepts.clear();
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

  private classifyTrigger(session: Session): UserMessagePercept["triggerType"] {
    if (session.isDirect) return "direct";
    if (session.quote?.user?.id === session.bot.selfId) return "reply";
    if (session.elements?.some((el) => el.type === "at" && el.attrs?.id === session.selfId))
      return "mention";
    if (this.config.keywords?.some((kw) => session.content?.includes(kw))) return "keyword";
    return "random";
  }

  private async recordUserMessage(session: Session): Promise<void> {
    this.logger.info(
      `user message | ${session.author?.name} | ${session.cid} | ${session.content}`,
    );
    if (session.guildId) {
      await this.updateMemberInfo(session, `guild:${session.guildId}`);
    } else if (session.isDirect) {
      await this.updateMemberInfo(session, `direct:${session.platform}`);
    }
    await this.events.recordMessage({
      scope: {
        platform: session.platform,
        channelId: session.channelId ?? "",
        guildId: session.guildId,
        isDirect: session.isDirect,
      },
      stage: TimelineStage.New,
      timestamp: new Date(session.timestamp),
      data: {
        messageId: session.messageId ?? "",
        senderId: session.author?.id ?? session.userId ?? "",
        senderName: session.author?.nick || session.author?.name || session.userId || "",
        content: session.content ?? "",
      },
    });
  }

  private async recordBotSentMessage(session: Session): Promise<void> {
    if (!session.content || !session.messageId) return;
    await this.events.recordMessage({
      scope: {
        platform: session.platform,
        channelId: session.channelId ?? "",
        guildId: session.guildId,
        isDirect: session.isDirect,
      },
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

  private buildPercept(session: Session): UserMessagePercept {
    return {
      id: Random.id(),
      type: PerceptType.UserMessage,
      scope: {
        platform: session.platform,
        channelId: session.channelId,
        guildId: session.guildId,
        isDirect: session.isDirect,
      },
      priority: 5,
      timestamp: new Date(),
      triggerType: this.classifyTrigger(session),
      payload: {
        messageId: session.messageId ?? "",
        content: session.content ?? "",
        sender: {
          id: session.userId ?? "",
          name: session.author?.nick || session.author?.name || session.userId || "",
        },
        channel: {
          id: session.channelId ?? "",
          platform: session.platform ?? "",
          guildId: session.guildId,
        },
      },
      runtime: { session },
    };
  }

  private schedulePercept(channelKey: string, percept: UserMessagePercept): void {
    if (percept.scope.isDirect) {
      this.ctx.emit("horizon/percept", percept);
      return;
    }

    const existing = this.pendingPercepts.get(channelKey);
    if (existing) {
      existing.clearTimer();
      const existingPriority = TRIGGER_PRIORITY[existing.percept.triggerType] ?? 0;
      const newPriority = TRIGGER_PRIORITY[percept.triggerType] ?? 0;
      if (existingPriority > newPriority) percept = existing.percept;
    }

    const window = this.config.aggregationWindow ?? 1500;
    const clearTimer = this.ctx.setTimeout(() => {
      this.pendingPercepts.delete(channelKey);
      this.ctx.emit("horizon/percept", percept);
    }, window);

    this.pendingPercepts.set(channelKey, { clearTimer, percept });
  }
}
