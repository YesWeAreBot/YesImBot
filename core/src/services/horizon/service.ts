import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Context, Schema, Service, type Session } from "koishi";
import Mustache from "mustache";

import { type ChannelKey, type Percept } from "../shared/types";
import { EnvironmentManager } from "./environment";
import { EventListener } from "./listener";
import { EventManager } from "./manager";
import type {
  AllowedChannel,
  Entity,
  EntityRecord,
  Environment,
  HorizonView,
  Observation,
  SelfInfo,
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
  botName: Schema.string(),
  entityCacheTtl: Schema.number().default(3600000),
  maxActiveEntities: Schema.number().default(15),
});

export class HorizonService extends Service<HorizonServiceConfig> {
  static inject = ["database", "yesimbot.prompt", "yesimbot.formatter"];

  public events: EventManager;
  public listener: EventListener;

  private horizonViewTpl?: string;
  private shortIdCounters = new Map<string, number>(); // channelKey -> next counter
  private shortIdMaps = new Map<string, Map<string, number>>(); // channelKey -> (nativeMsgId -> shortId)
  private shortIdReverse = new Map<string, Map<number, string>>(); // channelKey -> (shortId -> nativeMsgId)
  private botRoleCache = new Map<string, { role: "owner" | "admin" | null; fetchedAt: number }>();

  private environments: EnvironmentManager;

  constructor(ctx: Context, config: HorizonServiceConfig) {
    super(ctx, "yesimbot.horizon", false);
    this.config = config;
    this.events = new EventManager(ctx);
    this.listener = new EventListener(ctx, this.events, this.config);
    this.loadShortIdMaps();
    this.environments = new EnvironmentManager(ctx, config.entityCacheTtl);
  }

  protected async start(): Promise<void> {
    this.ctx.model.extend(
      "yesimbot.timeline",
      {
        id: "string(32)",
        platform: "string(64)",
        channelId: "string(255)",
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
        userId: "string(255)",
        username: "string(255)",
        nickname: "string(255)",
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
    this.botRoleCache.clear();
    this.logger.info("HorizonService stopped");
  }

  private classifyRole(roles: string[]): "owner" | "admin" | null {
    if (roles.some((r) => /^owner$/i.test(r))) return "owner";
    if (roles.some((r) => /^(admin|administrator|moderator)$/i.test(r))) return "admin";
    return null;
  }

  private async getBotRole(key: ChannelKey, session?: Session): Promise<"owner" | "admin" | null> {
    const cacheKey = `${key.platform}:${session?.guildId ?? key.channelId}`;
    const cached = this.botRoleCache.get(cacheKey);
    const ttl = 10 * 60 * 1000; // 10 minutes
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.role;

    if (!session?.guildId || !session?.bot?.selfId) return null;
    try {
      const member = await session.bot.getGuildMember(session.guildId, session.bot.selfId);
      const roles: string[] = ((member as Record<string, unknown>).roles as string[]) ?? [];
      const role = this.classifyRole(roles);
      this.botRoleCache.set(cacheKey, { role, fetchedAt: Date.now() });
      return role;
    } catch {
      this.botRoleCache.set(cacheKey, { role: null, fetchedAt: Date.now() });
      return null; // silent degradation
    }
  }

  async buildView(key: ChannelKey, options?: ViewOptions): Promise<HorizonView> {
    const entries = await this.events.query({
      key: { platform: key.platform, channelId: key.channelId },
      types: [
        TimelineEventType.Message,
        TimelineEventType.AgentResponse,
        TimelineEventType.AgentAction,
      ],
      limit: this.config.historyLimit ?? 30,
      orderBy: "desc",
    });
    const history = this.events.toObservations(entries.reverse());
    const environment = await this.environments.getOrCreate(key, options?.session);
    const entities = await this.getEntities(key, options?.session);
    const botRole = await this.getBotRole(key, options?.session);
    const self: SelfInfo = {
      id: options?.selfId ?? "",
      name: this.config.botName || options?.selfName || options?.selfId || "",
      role: botRole ?? undefined,
    };
    return { self, environment: environment ?? undefined, entities, history };
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
      userId: r.userId,
      username: r.username,
      nickname: r.nickname,
      attributes: r.attributes,
    }));
  }

  private loadShortIdMaps(): void {
    try {
      const data = readFileSync(
        path.join(this.ctx.baseDir, "data", "yesimbot", "shortIdMaps.json"),
        "utf-8",
      );
      const obj: {
        shortIdCounters: Record<string, number>;
        shortIdMaps: Record<string, Record<string, number>>;
      } = JSON.parse(data);
      this.shortIdCounters = new Map(Object.entries(obj.shortIdCounters));
      this.shortIdMaps = new Map(
        Object.entries(obj.shortIdMaps).map(([k, v]) => [k, new Map(Object.entries(v))]),
      );
      this.shortIdReverse = new Map(
        Object.entries(obj.shortIdMaps).map(([k, v]) => [
          k,
          new Map(Object.entries(v).map(([pid, sid]) => [Number(sid), pid])),
        ]),
      );
    } catch (e) {
      this.ctx.logger.warn("Failed to load shortIdMaps");
      this.shortIdCounters = new Map();
      this.shortIdMaps = new Map();
    }
  }

  private saveShortIdMaps(): void {
    const obj = {
      shortIdCounters: Object.fromEntries(this.shortIdCounters),
      shortIdMaps: Object.fromEntries(
        Array.from(this.shortIdMaps.entries()).map(([k, v]) => [k, Object.fromEntries(v)]),
      ),
    };
    const data = JSON.stringify(obj);
    const filePath = path.join(this.ctx.baseDir, "data", "yesimbot", "shortIdMaps.json");

    try {
      if (!existsSync(filePath)) {
        mkdirSync(path.dirname(filePath), { recursive: true });
      }
      writeFileSync(filePath, data);
    } catch (e) {
      this.ctx.logger.error("Failed to save shortIdMaps: %s", e);
    }
  }

  assignShortId(channelKey: string, nativeMsgId: string): number {
    let map = this.shortIdMaps.get(channelKey);
    if (!map) {
      map = new Map<string, number>();
      this.shortIdMaps.set(channelKey, map);
      this.saveShortIdMaps();
    }
    const existing = map.get(nativeMsgId);
    if (existing !== undefined) return existing;

    // Evict oldest entries if map exceeds 100
    if (map.size >= 100) {
      let evictCount = map.size - 80;
      const rev = this.shortIdReverse.get(channelKey);
      for (const [pid, sid] of map) {
        if (evictCount-- <= 0) break;
        map.delete(pid);
        rev?.delete(sid); // sync reverse map eviction
      }
    }

    const counter = ((this.shortIdCounters.get(channelKey) ?? 0) % 999) + 1;
    this.shortIdCounters.set(channelKey, counter);
    map.set(nativeMsgId, counter);

    // Populate reverse map
    let rev = this.shortIdReverse.get(channelKey);
    if (!rev) {
      rev = new Map();
      this.shortIdReverse.set(channelKey, rev);
    }
    rev.set(counter, nativeMsgId);

    this.saveShortIdMaps();

    return counter;
  }

  getShortId(channelKey: string, nativeMsgId: string): number | undefined {
    return this.shortIdMaps.get(channelKey)?.get(nativeMsgId);
  }

  lookupNativeMsgId(channelKey: string, shortId: number): string | undefined {
    return this.shortIdReverse.get(channelKey)?.get(shortId);
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
    // Escape dynamic values for XML attributes
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (obs.type === "message") {
      const hhmm = obs.timestamp.toTimeString().slice(0, 5);
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
        let attrs = `id="${shortId}" sender="${esc(senderName)}" senderId="${esc(senderId)}" time="${hhmm}"`;
        if (obs.replyTo) {
          const replyShortId = this.getShortId(channelKey, obs.replyTo);
          if (replyShortId !== undefined) {
            attrs += ` replyTo="${replyShortId}"`;
          }
        }
        // obs.content is pre-formatted by ElementFormatterService — safe to embed directly
        return `<msg ${attrs}>${obs.content}</msg>`;
      }
      // Fallback: no channelKey — legacy [HH:MM] format (used by agent/service.ts willingness context)
      if (selfId && obs.sender.id === selfId) {
        return `[${hhmm}] [Bot] ${obs.sender.name}: ${obs.content}`;
      }
      const badge = this.getRoleBadge(obs.sender.attributes);
      return `[${hhmm}] ${badge}${obs.sender.name}: ${obs.content}`;
    }

    if (obs.type === "agent.action") {
      const d = obs.data;
      const triggerAttr = d.triggerMsgId
        ? ` trigger="#${this.getShortId(channelKey ?? "", d.triggerMsgId) ?? "?"}"`
        : "";
      const lines = d.actions.map((a) => {
        const r = d.toolResults.find((t) => t.name === a.name);
        if (a.name === "send_message") {
          const ok = r?.status === "ok" || r?.status === "fulfilled" || (r != null && !r.error);
          return ok ? "send_message -> sent" : `send_message -> failed: ${r?.error ?? "unknown"}`;
        }
        const status = r ? r.status + (r.error ? ": " + r.error : "") : "no result";
        const preview = r?.result != null ? String(r.result).slice(0, 200) : "";
        return `${a.name}(${JSON.stringify(a.params ?? {})}) -> ${status}${preview ? ": " + preview : ""}`;
      });
      return `<bot-action round="${d.round}"${triggerAttr}>${lines.join("; ")}</bot-action>`;
    }

    if (obs.type === "agent.response") {
      if (obs.data.error) {
        return `<bot-error round="${obs.data.round}">${esc(obs.data.error)}</bot-error>`;
      }
      // Successful LLM response — actions rendered via AgentActionObservation
      return "";
    }

    return "";
  }

  formatHorizonText(view: HorizonView, workingMemory?: string[], percept?: Percept): string {
    this.horizonViewTpl ??= this.ctx["yesimbot.prompt"].loadPartial("horizon-view");
    let environment = "";
    if (view.environment) {
      const env = view.environment;
      const platform = env.platform || "";
      const channelId = env.channelId || "";
      const typeLabel = env.type === "private" ? "Private" : "Group";
      environment = `Platform: ${platform}, Channel: ${channelId} (${typeLabel})`;
    }

    let activeMembers = "";
    if (view.entities?.length || view.self.id) {
      const lines: string[] = [];

      // Render bot self entity first with self="true"
      if (view.self.id) {
        const selfParts = [`id="${view.self.id}"`, `name="${view.self.name}"`];
        if (view.self.role) selfParts.push(`role="${view.self.role}"`);
        selfParts.push(`self="true"`);
        lines.push(`<member ${selfParts.join(" ")} />`);
      }

      // Render other members from entities
      for (const e of view.entities ?? []) {
        const userId = e.userId ?? e.id;
        const username = e.username ?? e.name;
        const nickname = e.nickname;
        const displayName =
          nickname && nickname !== username ? `${nickname} (${username})` : (nickname ?? username);
        const parts = [`id="${userId}"`, `name="${displayName}"`];
        const role = this.classifyRole(
          Array.isArray(e.attributes?.roles) ? (e.attributes.roles as string[]) : [],
        );
        if (role) parts.push(`role="${role}"`);
        lines.push(`<member ${parts.join(" ")} />`);
      }

      activeMembers = lines.join("\n");
    }

    const historyObs: string[] = [];
    const triggerObs: string[] = [];
    const channelKey = view.environment
      ? `${view.environment.platform}:${view.environment.channelId}`
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
        platform: view.environment?.platform || "{{channel.platform}}",
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
