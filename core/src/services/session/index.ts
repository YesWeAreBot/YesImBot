import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { SessionManager } from "@yesimbot/agent/session";
import { Context, Logger, Service } from "koishi";

import { encodeChannelId } from "./encoding.js";

type ChannelKey = string;

export { encodeChannelId } from "./encoding.js";

export interface ChannelMeta {
  platform: string;
  channel: string;
  type: "private" | "group";
  current_session: string;
  last_message: string;
  updated_at: string;
  session_count: number;
}

export interface SessionNewEvent {
  platform: string;
  channelId: string;
  sessionManager: SessionManager;
}

declare module "koishi" {
  interface Context {
    "yesimbot.session": SessionService;
  }
  interface Events {
    "session:new"(event: SessionNewEvent): void;
  }
}

export interface SessionConfig {
  basePath: string;
  logLevel?: number;
}

export class SessionService extends Service<SessionConfig> {
  static inject = ["yesimbot.model"];
  readonly logger: Logger;

  private managers = new Map<ChannelKey, SessionManager>();
  private basePath: string;

  constructor(
    public ctx: Context,
    public config: SessionConfig,
  ) {
    super(ctx, "yesimbot.session");
    this.logger = ctx.logger("yesimbot.session");
    this.logger.level = config.logLevel ?? 2;
    this.basePath = config.basePath;
  }

  protected async start() {
    this.logger.info("Starting yesimbot session service");

    this.ctx.command("new", "创建新会话").action(async ({ session }) => {
      if (!session?.platform || !session?.channelId) {
        return "无法获取频道信息";
      }
      const newManager = await this.newSession(
        session.platform,
        session.channelId,
        session.isDirect ? "private" : "group",
      );
      this.ctx.emit("session:new", {
        platform: session.platform,
        channelId: session.channelId,
        sessionManager: newManager,
      });
      return "新会话已创建";
    });
  }

  getChannelDir(platform: string, channel: string): string {
    const encoded = encodeChannelId(platform, channel);
    return join(this.basePath, "sessions", encoded);
  }

  async getOrCreate(
    platform: string,
    channel: string,
    type: "private" | "group",
  ): Promise<SessionManager> {
    const key: ChannelKey = `${platform}:${channel}`;
    const cached = this.managers.get(key);
    if (cached) return cached;

    const channelDir = this.getChannelDir(platform, channel);
    if (!existsSync(channelDir)) {
      mkdirSync(channelDir, { recursive: true });
    }

    const meta = readMeta(channelDir);
    let sessionManager: SessionManager;

    if (meta?.current_session) {
      const sessionFile = join(channelDir, meta.current_session);
      if (existsSync(sessionFile)) {
        sessionManager = SessionManager.open(sessionFile, channelDir, this.basePath);
      } else {
        sessionManager = SessionManager.create(this.basePath, channelDir);
        writeMeta(
          channelDir,
          createMeta(platform, channel, type, sessionManager.getSessionFile()!, 1),
        );
      }
    } else {
      sessionManager = SessionManager.create(this.basePath, channelDir);
      writeMeta(
        channelDir,
        createMeta(platform, channel, type, sessionManager.getSessionFile()!, 1),
      );
    }

    this.managers.set(key, sessionManager);
    return sessionManager;
  }

  async newSession(
    platform: string,
    channel: string,
    type: "private" | "group",
  ): Promise<SessionManager> {
    const key: ChannelKey = `${platform}:${channel}`;
    this.managers.delete(key);

    const channelDir = this.getChannelDir(platform, channel);
    if (!existsSync(channelDir)) {
      mkdirSync(channelDir, { recursive: true });
    }

    const sessionManager = SessionManager.create(this.basePath, channelDir);
    const meta = readMeta(channelDir);
    const sessionCount = (meta?.session_count ?? 0) + 1;
    writeMeta(
      channelDir,
      createMeta(platform, channel, type, sessionManager.getSessionFile()!, sessionCount),
    );

    this.managers.set(key, sessionManager);
    return sessionManager;
  }

  async getMetadata(platform: string, channel: string): Promise<ChannelMeta | null> {
    const channelDir = this.getChannelDir(platform, channel);
    return readMeta(channelDir);
  }
}

function readMeta(channelDir: string): ChannelMeta | null {
  const metaPath = join(channelDir, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as ChannelMeta;
  } catch {
    return null;
  }
}

function writeMeta(channelDir: string, meta: ChannelMeta): void {
  const metaPath = join(channelDir, "meta.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function createMeta(
  platform: string,
  channel: string,
  type: "private" | "group",
  sessionFile: string,
  sessionCount: number,
): ChannelMeta {
  return {
    platform,
    channel,
    type,
    current_session: basename(sessionFile),
    last_message: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    session_count: sessionCount,
  };
}
