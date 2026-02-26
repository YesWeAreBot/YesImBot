import { Context, Schema, Service, type Session } from "koishi";
import Mustache from "mustache";

import { type ChannelKey, type Percept } from "../shared/types";
import { EventListener } from "./listener";
import { EventManager } from "./manager";
import type {
  AllowedChannel,
  Entity,
  EntityRecord,
  Environment,
  HorizonView,
  Observation,
  TimelineEntry,
  ViewOptions,
} from "./types";
import { TimelineEventType } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.horizon": HorizonService;
  }
  interface Tables {
    "yesimbot.timeline": TimelineEntry;
    "yesimbot.entity": EntityRecord;
  }
}

export interface HorizonServiceConfig {
  allowedChannels: AllowedChannel[];
  keywords?: string[];
  aggregationWindow?: number;
  historyLimit?: number;
  archiveThresholdMs?: number;
  botName?: string;
  entityCacheTtl?: number;
  maxActiveEntities?: number;
}

export const HorizonServiceConfigSchema: Schema<HorizonServiceConfig> = Schema.object({
  allowedChannels: Schema.array(
    Schema.object({
      platform: Schema.string().required(),
      type: Schema.union(["private", "guild"]).required(),
      id: Schema.string().required(),
    }),
  )
    .default([])
    .role("table"),
  keywords: Schema.array(Schema.string()).default([]),
  aggregationWindow: Schema.number().default(1500),
  historyLimit: Schema.number().default(30),
  archiveThresholdMs: Schema.number().default(86400000),
  botName: Schema.string().description("Bot display name (overrides platform name)"),
  entityCacheTtl: Schema.number().default(3600000).description("Entity cache TTL in ms"),
  maxActiveEntities: Schema.number().default(15).description("Max entities shown to LLM"),
});

export class HorizonService extends Service<HorizonServiceConfig> {
  static inject = ["database", "yesimbot.prompt"];

  public events: EventManager;
  public listener: EventListener;

  private horizonViewTpl?: string;
  private shortIdCounters = new Map<string, number>(); // channelKey -> next counter
  private shortIdMaps = new Map<string, Map<string, number>>(); // channelKey -> (platformMsgId -> shortId)

  constructor(ctx: Context, config: HorizonServiceConfig) {
    super(ctx, "yesimbot.horizon", false);
    this.config = config;
    this.events = new EventManager(ctx);
    this.listener = new EventListener(ctx, this.events, this.config);
  }

  protected async start(): Promise<void> {
    // Phase 28 (CTX-08) will migrate scope column to bare platform/channelId columns
    this.ctx.model.extend(
      "yesimbot.timeline",
      {
        id: "string(32)",
        scope: "json",
        type: "string(32)",
        priority: "unsigned",
        stage: "string(16)",
        timestamp: "timestamp",
        data: "json",
      } as Record<string, unknown> as never,
      { primary: "id", autoInc: false },
    );

    this.ctx.model.extend(
      "yesimbot.entity",
      {
        id: "string(64)",
        type: "string(32)",
        name: "string(255)",
        parentId: "string(255)",
        refId: "string(255)",
        attributes: "json",
        updatedAt: "timestamp",
      },
      { primary: "id" },
    );

    this.listener.start();
    this.logger.info("HorizonService started");
  }

  protected async stop(): Promise<void> {
    this.logger.info("HorizonService stopped");
  }

  async buildView(key: ChannelKey, options?: ViewOptions): Promise<HorizonView> {
    const entries = await this.events.query({
      key: { platform: key.platform, channelId: key.channelId },
      types: [TimelineEventType.Message, TimelineEventType.AgentResponse],
      limit: this.config.historyLimit ?? 30,
      orderBy: "desc",
    });
    const history = this.events.toObservations(entries.reverse());
    const environment = await this.getOrCreateEnvironment(key, options?.session);
    const entities = await this.getEntities(key, options?.session);
    const self = {
      id: options?.selfId ?? "",
      name: this.config.botName || options?.selfName || options?.selfId || "",
    };
    return { self, environment: environment ?? undefined, entities, history };
  }

  private async getOrCreateEnvironment(
    key: ChannelKey,
    session?: Session,
  ): Promise<Environment | null> {
    if (!key.channelId) return null;
    const id = `${key.platform}:${key.channelId}`;
    const ttl = this.config.entityCacheTtl ?? 3600000;
    const rows = await this.ctx.database.get("yesimbot.entity", { id, type: "channel" });
    if (rows?.length) {
      const row = rows[0];
      if (Date.now() - new Date(row.updatedAt).getTime() < ttl) {
        return {
          type: (session?.isDirect ?? false) ? "private" : "group",
          id: row.id,
          name: row.name,
          platform: row.attributes?.platform as string,
          channelId: row.attributes?.channelId as string,
          metadata: row.attributes ?? {},
        };
      }
    }
    let channelName = session?.event?.channel?.name || session?.event?.guild?.name || null;
    if (!channelName && session?.bot) {
      try {
        const ch = await session.bot.getChannel(key.channelId, session?.guildId);
        channelName = ch?.name || null;
      } catch {}
    }
    if (!channelName) channelName = `${key.platform}:${key.channelId}`;
    await this.ctx.database.upsert("yesimbot.entity", [
      {
        id,
        type: "channel",
        name: channelName,
        attributes: {
          platform: key.platform,
          isDirect: session?.isDirect ?? false,
          channelId: key.channelId,
          userId: session?.userId,
          guildId: session?.guildId,
        },
        updatedAt: new Date(),
      },
    ]);
    return {
      type: (session?.isDirect ?? false) ? "private" : "group",
      id,
      name: channelName,
      platform: key.platform,
      channelId: key.channelId,
      metadata: {
        platform: key.platform,
        channelId: key.channelId,
        userId: session?.userId,
        guildId: session?.guildId,
        isDirect: session?.isDirect ?? false,
      },
    };
  }

  async getEntities(key: ChannelKey, session?: Session): Promise<Entity[]> {
    const parentId = session?.guildId
      ? `guild:${session.guildId}`
      : (session?.isDirect ?? false)
        ? `direct:${key.platform}`
        : null;
    if (!parentId) return [];
    const limit = this.config.maxActiveEntities ?? 15;
    const rows: EntityRecord[] = await this.ctx.database
      .select("yesimbot.entity")
      .where({ parentId })
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .execute();
    return (rows ?? []).map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      attributes: r.attributes,
    }));
  }

  assignShortId(channelKey: string, platformMsgId: string): number {
    let map = this.shortIdMaps.get(channelKey);
    if (!map) {
      map = new Map<string, number>();
      this.shortIdMaps.set(channelKey, map);
    }
    const existing = map.get(platformMsgId);
    if (existing !== undefined) return existing;

    // Evict oldest entries if map exceeds 100
    if (map.size >= 100) {
      let evictCount = map.size - 80;
      for (const key of map.keys()) {
        if (evictCount-- <= 0) break;
        map.delete(key);
      }
    }

    const counter = ((this.shortIdCounters.get(channelKey) ?? 0) % 999) + 1;
    this.shortIdCounters.set(channelKey, counter);
    map.set(platformMsgId, counter);
    return counter;
  }

  getShortId(channelKey: string, platformMsgId: string): number | undefined {
    return this.shortIdMaps.get(channelKey)?.get(platformMsgId);
  }

  private getRoleBadge(attributes?: Record<string, unknown>): string {
    const roles = attributes?.roles;
    if (!Array.isArray(roles)) return "";
    const special = roles.find(
      (r) => typeof r === "string" && /^(owner|admin|administrator)$/i.test(r),
    );
    if (!special) return "";
    const lower = (special as string).toLowerCase();
    return lower === "owner" ? "[Owner] " : "[Admin] ";
  }

  formatObservation(obs: Observation, selfId?: string, channelKey?: string): string {
    const hhmm = obs.timestamp.toTimeString().slice(0, 5);
    if (obs.type === "message") {
      if (channelKey) {
        const shortId = this.assignShortId(channelKey, obs.messageId);
        const isBot = selfId && obs.sender.id === selfId;
        const senderName = isBot
          ? "[Bot]"
          : (() => {
              const badge = this.getRoleBadge(obs.sender.attributes);
              return `${badge}${obs.sender.name}`;
            })();
        const senderId = isBot ? "bot" : obs.sender.id;
        let attrs = `id="${shortId}" sender="${senderName}" senderId="${senderId}"`;
        if (obs.replyTo) {
          const replyShortId = this.getShortId(channelKey, obs.replyTo);
          if (replyShortId !== undefined) {
            attrs += ` replyTo="${replyShortId}"`;
          }
        }
        return `<msg ${attrs}>${obs.content}</msg>`;
      }
      // Fallback: no channelKey — legacy [HH:MM] format
      if (selfId && obs.sender.id === selfId) {
        return `[${hhmm}] [Bot] ${obs.sender.name}: ${obs.content}`;
      }
      const badge = this.getRoleBadge(obs.sender.attributes);
      return `[${hhmm}] ${badge}${obs.sender.name}: ${obs.content}`;
    }
    const actions = obs.data.actions;
    const sendAction = actions.find((a) => a.name === "send_message");
    const otherTools = actions.filter((a) => a.name !== "send_message").map((a) => a.name);
    if (sendAction) {
      const content = (sendAction.params?.content as string) ?? "";
      const suffix = otherTools.length ? ` [also: ${otherTools.join(", ")}]` : "";
      return `[${hhmm}] [Bot]: ${content}${suffix}`;
    }
    return `[${hhmm}] [Bot Action]: ${actions.map((a) => a.name).join(", ")}`;
  }

  formatHorizonText(view: HorizonView, workingMemory?: string[], percept?: Percept): string {
    this.horizonViewTpl ??= this.ctx["yesimbot.prompt"].loadPartial("horizon-view");
    let environment = "";
    if (view.environment) {
      const env = view.environment;
      const platform = (env.metadata?.platform as string) || "";
      const channelId = (env.metadata?.channelId as string) || "";
      const typeLabel = env.type === "private" ? "Private" : "Group";
      environment = `Platform: ${platform}, Channel: ${channelId} (${typeLabel})`;
    }

    let activeMembers = "";
    if (view.entities?.length) {
      activeMembers = view.entities
        .map((e) => {
          const badge = this.getRoleBadge(e.attributes);
          return badge ? `${e.name} [${badge.trim().slice(1, -1)}]` : e.name;
        })
        .join(", ");
    }

    const historyObs: string[] = [];
    const triggerObs: string[] = [];
    const channelKey = view.environment
      ? `${view.environment.metadata?.platform}:${view.environment.metadata?.channelId}`
      : undefined;
    for (const obs of view.history ?? []) {
      const formatted = this.formatObservation(obs, view.self.id, channelKey);
      if (obs.type === "message" && obs.stage === "new") {
        triggerObs.push(formatted);
      } else {
        historyObs.push(formatted);
      }
    }

    const fmt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const scope = {
      // Snippet variables — nested objects for dot-path access
      date: { now: fmt.format(new Date()) },
      bot: {
        name: view.self.name || "{{bot.name}}",
        id: view.self.id || "{{bot.id}}",
      },
      sender: {
        name: (percept?.metadata?.senderName as string) || "{{sender.name}}",
        id: (percept?.metadata?.senderId as string) || "{{sender.id}}",
      },
      channel: {
        name: view.environment?.name || "{{channel.name}}",
        platform: (view.environment?.metadata?.platform as string) || "{{channel.platform}}",
      },
      // Template data
      environment,
      activeMembers,
      hasHistory: historyObs.length > 0,
      history: historyObs,
      hasTrigger: triggerObs.length > 0,
      trigger: triggerObs,
      hasWorkingMemory: (workingMemory?.length ?? 0) > 0,
      workingMemory,
    };

    const rendered = Mustache.render(this.horizonViewTpl, scope).trim();
    const unresolved = rendered.match(/\{\{[^}]+\}\}/g);
    if (unresolved) {
      this.logger.debug(`Unresolved template variables: ${unresolved.join(", ")}`);
    }
    return rendered;
  }
}
