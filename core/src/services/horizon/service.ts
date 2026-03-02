import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ImagePart, TextPart, UserContent } from "ai";
import { Context, Schema, Service, type Session } from "koishi";
import Mustache from "mustache";

import type { LoopMessage } from "../agent/trimmer";
import { type ChannelKey, type Percept } from "../shared/types";
import { EnvironmentManager } from "./environment";
import { EventListener } from "./listener";
import { EventManager } from "./manager";
import type {
  AllowedChannel,
  Entity,
  EntityRecord,
  HorizonView,
  ImageConfig,
  Observation,
  Role,
  SelfInfo,
  TimelineEntry,
  ViewOptions,
} from "./types";
import { TimelineEventType } from "./types";

interface HistoryItemData {
  is_message: boolean;
  is_action: boolean;
  is_error: boolean;
  // message fields
  id?: number;
  time?: string; // "MM月DD日 HH:mm"
  senderLine?: string; // "SenderName(senderId)"
  replyLine?: string; // "[回复: N]" or undefined
  content?: string;
  // action fields
  actionContent?: string;
  // error fields
  errorContent?: string;
}

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
  static inject = ["database", "yesimbot.prompt", "yesimbot.formatter", "yesimbot.image-cache"];

  public events: EventManager;
  public listener: EventListener;

  private historyItemTpl?: string;
  private shortIdCounters = new Map<string, number>(); // channelKey -> next counter
  private shortIdMaps = new Map<string, Map<string, number>>(); // channelKey -> (nativeMsgId -> shortId)
  private shortIdReverse = new Map<string, Map<number, string>>(); // channelKey -> (shortId -> nativeMsgId)
  private botRoleCache = new Map<string, { role: Role | null; fetchedAt: number }>();

  private environments: EnvironmentManager;

  constructor(ctx: Context, config: HorizonServiceConfig) {
    super(ctx, "yesimbot.horizon", false);
    this.config = config;
    this.events = new EventManager(ctx);
    this.listener = new EventListener(ctx, this.events, this.config);
    this.loadShortIdMaps();
    this.environments = new EnvironmentManager(ctx, config.entityCacheTtl);
    this.ctx.command("yesimbot.history", "上下文指令集", { authority: 3 });
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
      },
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

  private classifyRole(roles: string[]): Role | null {
    if (roles.some((r) => /^owner$/i.test(r))) return "owner";
    if (roles.some((r) => /^(admin|administrator|moderator)$/i.test(r))) return "admin";
    return null;
  }

  private async getBotRole(key: ChannelKey, session?: Session): Promise<Role | null> {
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
      name: options?.selfName || options?.selfId || "",
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

  formatObservation(
    obs: Observation,
    selfId?: string,
    channelKey?: string,
  ): HistoryItemData | null {
    // Escape dynamic values for XML attributes
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    if (obs.type === "message") {
      // formatObservation requires channelKey — no fallback path
      if (!channelKey) return null;

      const shortId = this.assignShortId(channelKey, obs.messageId);
      const isBot = selfId && obs.sender.id === selfId;
      const senderName = isBot
        ? "[Bot]"
        : (() => {
            const badge = this.getRoleBadge(obs.sender.attributes);
            return `${badge}${obs.sender.name}`;
          })();
      const senderId = isBot ? "bot" : obs.sender.id;

      // Time format: MM月DD日 HH:mm
      const d = obs.timestamp;
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const time = `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;

      // Inline sender format: SenderName(senderId)
      const senderLine = `${senderName}(${senderId})`;

      // Reply line: [回复: N] if replyTo shortId exists
      let replyLine: string | undefined;
      if (obs.replyTo) {
        const replyShortId = this.getShortId(channelKey, obs.replyTo);
        if (replyShortId !== undefined) {
          replyLine = `[回复: ${replyShortId}]`;
        }
      }

      return {
        is_message: true,
        is_action: false,
        is_error: false,
        id: shortId,
        time,
        senderLine,
        replyLine,
        content:
          typeof obs.content === "string"
            ? obs.content
            : obs.content
                .filter((p) => p.type === "text")
                .map((p) => (p as TextPart).text)
                .join(""),
      };
    }

    if (obs.type === "agent.action") {
      const d = obs.data;
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
      if (lines.length === 0) {
        lines.push(`(No actions)`);
      }
      return {
        is_message: false,
        is_action: true,
        is_error: false,
        actionContent: lines.join("; "),
      };
    }

    if (obs.type === "agent.response") {
      if (obs.data.error) {
        return {
          is_message: false,
          is_action: false,
          is_error: true,
          errorContent: esc(obs.data.error),
        };
      }
      // Successful LLM response — actions rendered via AgentActionObservation
      return null;
    }

    return null;
  }

  formatHorizonText(
    view: HorizonView,
    percept?: Percept,
    imageConfig?: ImageConfig,
  ): LoopMessage[] {
    const channelKey = view.environment
      ? `${view.environment.platform}:${view.environment.channelId}`
      : undefined;

    // Build preamble (environment + members)
    let environment = "";
    if (view.environment) {
      const env = view.environment;
      const typeLabel = env.type === "private" ? "Private" : "Group";
      environment = `Platform: ${env.platform || ""}, Channel: ${env.channelId || ""} (${typeLabel})`;
    }

    const memberLines: string[] = [];
    if (view.self.id) {
      const parts = [`id="${view.self.id}"`, `name="${view.self.name}"`];
      if (view.self.role) parts.push(`role="${view.self.role}"`);
      parts.push(`self="true"`);
      memberLines.push(`<member ${parts.join(" ")} />`);
    }
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
      memberLines.push(`<member ${parts.join(" ")} />`);
    }

    const preambleParts: string[] = [];
    if (environment) preambleParts.push(`<environment>${environment}</environment>`);
    if (memberLines.length) preambleParts.push(`<members>\n${memberLines.join("\n")}\n</members>`);
    const preamble = preambleParts.join("\n");

    this.historyItemTpl ??= this.ctx["yesimbot.prompt"].loadPartial("history-item");

    // Per-render image lifecycle tracker
    const lifecycleTracker = new Map<string, number>();
    let totalEmbedded = 0;
    const maxImages = imageConfig?.maxImagesInContext ?? 3;
    const maxLifecycle = imageConfig?.imageLifecycleCount ?? 3;
    const imgRegex = /<img id="([a-f0-9]+)"(?:\s+status="failed")?\/>/g;

    const buildUserContent = (texts: string[]): string | UserContent => {
      if (imageConfig?.imageMode !== "native") return texts.join("\n");

      type Candidate = { id: string; base64: string; mediaType: string; textIdx: number };
      // Pass 1: collect all eligible candidates (lifecycle check only, no budget limit)
      const processedTexts: string[] = [];
      const allCandidates: Candidate[] = [];
      for (let i = 0; i < texts.length; i++) {
        let processedText = texts[i];
        const matches: Array<{ id: string; full: string }> = [];
        let m: RegExpExecArray | null;
        imgRegex.lastIndex = 0;
        while ((m = imgRegex.exec(texts[i])) !== null) {
          matches.push({ id: m[1], full: m[0] });
        }
        for (const { id, full } of matches) {
          const entry = this.ctx["yesimbot.image-cache"].get(id);
          if (!entry) continue;
          if (entry.status === "failed") {
            processedText = processedText.replace(full, `<img id="${id}" status="failed"/>`);
            continue;
          }
          const count = lifecycleTracker.get(id) ?? 0;
          if (count >= maxLifecycle) continue;
          allCandidates.push({ id, base64: entry.base64, mediaType: entry.mediaType, textIdx: i });
        }
        processedTexts.push(processedText);
      }

      // FIFO eviction: keep only the LAST maxImages candidates (newest = latest in texts)
      const keepFrom = Math.max(0, allCandidates.length - maxImages);
      for (let i = keepFrom; i < allCandidates.length; i++) {
        const c = allCandidates[i];
        lifecycleTracker.set(c.id, (lifecycleTracker.get(c.id) ?? 0) + 1);
        totalEmbedded++;
      }

      // Pass 2: build parts array
      const parts: Array<TextPart | ImagePart> = [];
      let candidateIdx = 0;
      for (let i = 0; i < processedTexts.length; i++) {
        parts.push({ type: "text", text: processedTexts[i] });
        while (candidateIdx < allCandidates.length && allCandidates[candidateIdx].textIdx === i) {
          const c = allCandidates[candidateIdx];
          if (candidateIdx >= keepFrom) {
            parts.push({ type: "image", image: c.base64, mediaType: c.mediaType } as ImagePart);
          }
          candidateIdx++;
        }
      }

      if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
      return parts;
    };

    const messages: LoopMessage[] = [];

    // Add preamble as first user message
    if (preamble) messages.push({ role: "user", content: preamble });

    // Build history as multi-turn messages
    const history = view.history ?? [];
    let pendingMsgTexts: string[] = [];

    const flushPending = () => {
      if (pendingMsgTexts.length === 0) return;
      const content = buildUserContent(pendingMsgTexts);
      pendingMsgTexts = [];
      // Merge with previous user message if both are strings
      const last = messages[messages.length - 1];
      if (last && last.role === "user") {
        if (typeof last.content === "string" && typeof content === "string") {
          last.content = last.content + "\n" + content;
        } else {
          const lastParts: Array<TextPart | ImagePart> =
            typeof last.content === "string"
              ? [{ type: "text", text: last.content }]
              : (last.content as Array<TextPart | ImagePart>);
          const newParts: Array<TextPart | ImagePart> =
            typeof content === "string"
              ? [{ type: "text", text: content }]
              : (content as Array<TextPart | ImagePart>);
          last.content = [...lastParts, ...newParts];
        }
      } else {
        messages.push({ role: "user", content });
      }
    };

    for (const obs of history) {
      if (obs.type === "message" && obs.stage === "new") continue; // handled as trigger

      if (obs.type === "message") {
        const item = this.formatObservation(obs, view.self.id, channelKey);
        if (!item) continue;
        const text = Mustache.render(this.historyItemTpl, item).trim();
        pendingMsgTexts.push(text);
      } else if (obs.type === "agent.response") {
        flushPending();
        if (obs.data.error && !obs.data.rawText) continue;
        const rawText = obs.data.rawText || obs.data.assistantText || "";
        if (rawText) messages.push({ role: "assistant", content: rawText });
      } else if (obs.type === "agent.action") {
        flushPending();
        const item = this.formatObservation(obs, view.self.id, channelKey);
        if (!item) continue;
        const text = Mustache.render(this.historyItemTpl, item).trim();
        messages.push({ role: "user", content: text });
      }
    }
    flushPending();

    // Build trigger block (new-stage messages)
    const fmt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const triggerTexts: string[] = [`现在是 ${fmt.format(new Date())}。`];
    for (const obs of history) {
      if (obs.type !== "message" || obs.stage !== "new") continue;
      const item = this.formatObservation(obs, view.self.id, channelKey);
      if (!item) continue;
      triggerTexts.push(Mustache.render(this.historyItemTpl, item).trim());
    }
    if (triggerTexts.length > 1) {
      const content = buildUserContent(triggerTexts);
      messages.push({ role: "user", content });
    }

    return messages;
  }
}
