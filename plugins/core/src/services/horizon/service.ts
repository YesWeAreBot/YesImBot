import { Context, Service } from "koishi";

import { HorizonServiceConfig } from "./config";
import { EventListener } from "./listener";
import { EventManager } from "./manager";
import type {
  Entity,
  EntityRecord,
  Environment,
  HorizonView,
  Observation,
  Scope,
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

export class HorizonService extends Service<HorizonServiceConfig> {
  static inject = ["database"];

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
    let channelName =
      session?.event?.channel?.name || session?.event?.guild?.name || null;
    if (!channelName && session?.bot) {
      try {
        const ch = await session.bot.getChannel(scope.channelId, scope.guildId);
        channelName = ch?.name || null;
      } catch {}
    }
    if (!channelName) channelName = `${scope.platform}:${scope.channelId}`;
    await this.ctx.database.upsert("yesimbot.entity", [{
      id,
      type: "channel",
      name: channelName,
      attributes: { platform: scope.platform, isDirect: scope.isDirect, guildId: scope.guildId },
      updatedAt: new Date(),
    }]);
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

  formatObservation(obs: Observation, selfId?: string): string {
    const hhmm = obs.timestamp.toTimeString().slice(0, 5);
    if (obs.type === "message") {
      const prefix = selfId && obs.sender.id === selfId ? "[Bot] " : "";
      return `[${hhmm}] ${prefix}${obs.sender.name}: ${obs.content}`;
    }
    return `[${hhmm}] [Bot Summary]: ${obs.summary}`;
  }

  formatHorizonText(view: HorizonView): string {
    const lines: string[] = [];

    if (view.environment) {
      lines.push(`Environment: ${view.environment.name}`);
      if (view.environment.description) lines.push(view.environment.description);
    }

    if (view.entities?.length) {
      lines.push(`Active members: ${view.entities.map((e) => e.name).join(", ")}`);
    }

    if (view.history?.length) {
      lines.push("--- Message History ---");
      for (const obs of view.history) {
        lines.push(this.formatObservation(obs, view.self.id));
      }
    }

    const p = view.percept as UserMessagePercept;
    lines.push("--- Trigger ---");
    lines.push(`Type: ${p.triggerType}`);
    lines.push(`Message: ${p.payload.content}`);

    return lines.join("\n");
  }
}
