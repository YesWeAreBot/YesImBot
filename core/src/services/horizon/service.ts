import { Context, Schema, Service } from "koishi";
import Mustache from "mustache";

import { EventListener } from "./listener";
import { EventManager } from "./manager";
import type {
  AllowedChannel,
  Entity,
  EntityRecord,
  Environment,
  HorizonView,
  Observation,
  Scope,
  StructuredHorizonView,
  TimelineEntry,
  UserMessagePercept,
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

  constructor(ctx: Context, config: HorizonServiceConfig) {
    super(ctx, "yesimbot.horizon", false);
    this.config = config;
    this.events = new EventManager(ctx);
    this.listener = new EventListener(ctx, this.events, this.config);
  }

  protected async start(): Promise<void> {
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
      },
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

  async buildView(percept: UserMessagePercept): Promise<HorizonView> {
    const { platform, channelId } = percept.scope;
    const entries = await this.events.query({
      scope: { platform, channelId },
      types: [TimelineEventType.Message, TimelineEventType.AgentSummary],
      limit: this.config.historyLimit ?? 30,
      orderBy: "asc",
    });
    const history = this.events.toObservations(entries);
    const environment = await this.getOrCreateEnvironment(percept.scope, percept);
    const entities = await this.getEntities(percept.scope);
    const session = percept.runtime?.session;
    const self = {
      id: session?.bot?.selfId ?? "",
      name: this.config.botName || session?.bot?.user?.name || session?.bot?.selfId || "",
    };
    return { percept, self, environment: environment ?? undefined, entities, history };
  }

  toStructured(view: HorizonView): StructuredHorizonView {
    const env = view.environment;
    const environment = {
      name: env?.name ?? "",
      type: (env?.type === "private" ? "private" : "group") as "private" | "group",
      platform: (env?.metadata?.platform as string) || undefined,
    };

    const members = (view.entities ?? []).map((e) => {
      const badge = this.getRoleBadge(e.attributes);
      return { name: e.name, badge: badge ? badge.trim().slice(1, -1) : undefined };
    });

    const history = (view.history ?? []).map((obs) => {
      const time = obs.timestamp.toTimeString().slice(0, 5);
      if (obs.type === "message") {
        const isBot = view.self?.id ? obs.sender.id === view.self.id : false;
        return { time, sender: obs.sender.name, content: obs.content, isBot: isBot || undefined };
      }
      return { time, sender: "", content: obs.summary, isSummary: true };
    });

    return { environment, members, history };
  }

  private async getOrCreateEnvironment(
    scope: Scope,
    percept: UserMessagePercept,
  ): Promise<Environment | null> {
    if (!scope.channelId) return null;
    const id = `${scope.platform}:${scope.channelId}`;
    const ttl = this.config.entityCacheTtl ?? 3600000;
    const rows = await this.ctx.database.get("yesimbot.entity", { id, type: "channel" });
    if (rows?.length) {
      const row = rows[0];
      if (Date.now() - new Date(row.updatedAt).getTime() < ttl) {
        return {
          type: scope.isDirect ? "private" : "group",
          id: row.id,
          name: row.name,
          metadata: row.attributes ?? {},
        };
      }
    }
    const session = percept.runtime?.session;
    let channelName = session?.event?.channel?.name || session?.event?.guild?.name || null;
    if (!channelName && session?.bot) {
      try {
        const ch = await session.bot.getChannel(scope.channelId, scope.guildId);
        channelName = ch?.name || null;
      } catch {}
    }
    if (!channelName) channelName = `${scope.platform}:${scope.channelId}`;
    await this.ctx.database.upsert("yesimbot.entity", [
      {
        id,
        type: "channel",
        name: channelName,
        attributes: { platform: scope.platform, isDirect: scope.isDirect, guildId: scope.guildId },
        updatedAt: new Date(),
      },
    ]);
    return {
      type: scope.isDirect ? "private" : "group",
      id,
      name: channelName,
      metadata: { platform: scope.platform },
    };
  }

  async getEntities(scope: Scope): Promise<Entity[]> {
    const parentId = scope.guildId
      ? `guild:${scope.guildId}`
      : scope.isDirect
        ? `direct:${scope.platform}`
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

  formatObservation(obs: Observation, selfId?: string): string {
    const hhmm = obs.timestamp.toTimeString().slice(0, 5);
    if (obs.type === "message") {
      if (selfId && obs.sender.id === selfId) {
        return `[${hhmm}] [Bot] ${obs.sender.name}: ${obs.content}`;
      }
      const badge = this.getRoleBadge(obs.sender.attributes);
      return `[${hhmm}] ${badge}${obs.sender.name}: ${obs.content}`;
    }
    return `[${hhmm}] [Bot Summary]: ${obs.summary}`;
  }

  private horizonViewTpl?: string;

  formatHorizonText(view: HorizonView): string {
    this.horizonViewTpl ??= this.ctx["yesimbot.prompt"].loadPartial("horizon-view");
    let environment = "";
    if (view.environment) {
      const env = view.environment;
      const platform = (env.metadata?.platform as string) || "";
      const typeLabel = env.type === "private" ? "Private" : "Group";
      environment =
        platform && !env.name.includes(":")
          ? `${env.name} (${platform}, ${typeLabel})`
          : `${env.name} (${typeLabel})`;
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

    const observations =
      view.history?.map((obs) => this.formatObservation(obs, view.self.id)) ?? [];
    const p = view.percept as UserMessagePercept;

    return Mustache.render(this.horizonViewTpl, {
      environment,
      activeMembers,
      hasHistory: observations.length > 0,
      observations,
      triggerType: p.triggerType,
      triggerMessage: p.payload.content,
    }).trim();
  }
}
