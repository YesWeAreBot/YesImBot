import { Context, Service } from "koishi";

import { EventManager } from "./event-manager";
import { EventListener } from "./listener";
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

export interface HorizonConfig {
  allowedChannels: Array<{ platform: string; type: string; id: string }>;
  keywords?: string[];
  aggregationWindow?: number;
  historyLimit?: number;
}

export class HorizonService extends Service<HorizonConfig> {
  static inject = ["database"];

  public events: EventManager;
  public listener: EventListener;

  constructor(ctx: Context, config: HorizonConfig) {
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
    const environment = await this.getEnvironment(percept.scope);
    const entities = await this.getEntities(percept.scope);
    const session = percept.runtime?.session;
    const self = {
      id: session?.bot?.selfId ?? "",
      name: session?.bot?.user?.name ?? session?.bot?.selfId ?? "",
    };
    return { percept, self, environment: environment ?? undefined, entities, history };
  }

  async getEnvironment(scope: Scope): Promise<Environment | null> {
    if (!scope.channelId) return null;
    const id = `${scope.platform}:${scope.channelId}`;
    const rows = await this.ctx.database.get("yesimbot.entity", {
      id,
      type: "channel",
    });
    if (!rows?.length) return null;
    const row: EntityRecord = rows[0];
    return {
      type: "channel",
      id: row.id,
      name: row.name,
      description: row.attributes?.description as string,
      metadata: row.attributes ?? {},
    };
  }

  async getEntities(scope: Scope): Promise<Entity[]> {
    if (!scope.guildId) return [];
    const parentId = `guild:${scope.guildId}`;
    const rows: EntityRecord[] = await this.ctx.database.get("yesimbot.entity", {
      parentId,
    });
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
