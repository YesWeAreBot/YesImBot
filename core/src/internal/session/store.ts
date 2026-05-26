import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { SessionManager } from "@yesimbot/agent/session";
import type { Context, Logger } from "koishi";

import { encodeChannelId } from "./encoding.js";
import { createMeta, readChannelMap, readMeta, writeChannelMap, writeMeta } from "./storage.js";
import type {
  ChannelMapEntry,
  ChannelMeta,
  ChannelKey,
  GetOrCreateSessionInput,
  NewSessionInput,
  SessionRotatedEvent,
  SessionRotatedListener,
  SessionStoreConfig,
} from "./types.js";

export class SessionStore {
  readonly logger: Logger;
  private readonly managers = new Map<ChannelKey, SessionManager>();
  private readonly listeners = new Set<SessionRotatedListener>();
  private readonly basePath: string;

  constructor(
    private readonly ctx: Context,
    private readonly config: SessionStoreConfig,
  ) {
    this.logger = ctx.logger("yesimbot.session");
    this.logger.level = config.logLevel ?? 2;
    this.basePath = config.basePath;
  }

  start(): void {
    this.logger.info("Starting yesimbot session store");
    this.ctx.command("new", "创建新会话").action(async ({ session }) => {
      if (!session?.platform || !session?.channelId) {
        return "无法获取频道信息";
      }
      await this.newSession({
        platform: session.platform,
        channelId: session.channelId,
        type: session.isDirect ? "private" : "group",
      });
      return "新会话已创建";
    });
  }

  stop(): void {
    this.listeners.clear();
    this.managers.clear();
  }

  subscribeSessionRotated(listener: SessionRotatedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getChannelDir(platform: string, channelId: string): string {
    return join(this.basePath, "sessions", encodeChannelId(platform, channelId));
  }

  getChannelSettingsPath(platform: string, channelId: string): string {
    return join(this.getChannelDir(platform, channelId), "settings.json");
  }

  async getOrCreate(input: GetOrCreateSessionInput): Promise<SessionManager> {
    const key = `${input.platform}:${input.channelId}`;
    const cached = this.managers.get(key);
    if (cached) return cached;

    const channelDir = this.ensureChannelDir(input.platform, input.channelId);
    this.updateChannelMap(input.platform, input.channelId);

    const meta = readMeta(channelDir);
    let sessionManager: SessionManager;

    if (meta?.current_session && existsSync(join(channelDir, meta.current_session))) {
      sessionManager = SessionManager.open(join(channelDir, meta.current_session), channelDir);
    } else {
      sessionManager = SessionManager.create(channelDir);
      writeMeta(
        channelDir,
        createMeta(
          input.platform,
          input.channelId,
          input.type,
          sessionManager.getSessionFile()!,
          1,
        ),
      );
    }

    this.managers.set(key, sessionManager);
    return sessionManager;
  }

  async newSession(input: NewSessionInput): Promise<SessionManager> {
    const key = `${input.platform}:${input.channelId}`;
    this.managers.delete(key);

    const channelDir = this.ensureChannelDir(input.platform, input.channelId);
    this.updateChannelMap(input.platform, input.channelId);

    const sessionManager = SessionManager.create(channelDir);
    const meta = readMeta(channelDir);
    writeMeta(
      channelDir,
      createMeta(
        input.platform,
        input.channelId,
        input.type,
        sessionManager.getSessionFile()!,
        (meta?.session_count ?? 0) + 1,
      ),
    );

    this.managers.set(key, sessionManager);
    await this.emitSessionRotated({
      platform: input.platform,
      channelId: input.channelId,
      type: input.type,
      sessionManager,
    });
    return sessionManager;
  }

  async getMetadata(platform: string, channelId: string): Promise<ChannelMeta | null> {
    return readMeta(this.getChannelDir(platform, channelId));
  }

  getChannelKey(platform: string, channelId: string): string {
    return encodeChannelId(platform, channelId);
  }

  decodeChannelId(channelKey: string): ChannelMapEntry | null {
    return this.getChannelMap()[channelKey] ?? null;
  }

  getChannelMap(): Record<string, ChannelMapEntry> {
    return readChannelMap(this.getChannelMapPath());
  }

  clearCachedManager(platform: string, channelId: string): void {
    this.managers.delete(`${platform}:${channelId}`);
  }

  private ensureChannelDir(platform: string, channelId: string): string {
    const channelDir = this.getChannelDir(platform, channelId);
    if (!existsSync(channelDir)) mkdirSync(channelDir, { recursive: true });
    return channelDir;
  }

  private getChannelMapPath(): string {
    return join(this.basePath, "sessions", "channel-map.json");
  }

  private updateChannelMap(platform: string, channelId: string): void {
    const map = this.getChannelMap();
    map[encodeChannelId(platform, channelId)] = { platform, channelId };
    writeChannelMap(this.getChannelMapPath(), map);
  }

  private async emitSessionRotated(event: SessionRotatedEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }
}
