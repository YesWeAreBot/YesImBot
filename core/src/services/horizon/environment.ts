import path from "node:path";

import type { Context, Session } from "koishi";

import { JsonDB } from "../../utils";
import type { ChannelKey } from "../shared/types";
import type { Environment } from "./types";

export class EnvironmentManager {
  private db: JsonDB<Record<string, Environment & { updatedAt: string }>>;
  private cacheTtl: number;

  constructor(ctx: Context, cacheTtl: number = 3600000) {
    this.cacheTtl = cacheTtl;
    this.db = new JsonDB(path.join(ctx.baseDir, "data", "yesimbot", "environments.json"), {});
  }

  async getOrCreate(key: ChannelKey, session?: Session): Promise<Environment | null> {
    if (!key.channelId) return null;
    const id = `${key.platform}:${key.channelId}`;
    const env = this.db.get(id);
    if (env) {
      if (Date.now() - new Date(env.updatedAt ?? 0).getTime() < this.cacheTtl) {
        return env;
      }
    }
    let channelName = session?.event?.channel?.name || session?.event?.guild?.name || null;
    if (!channelName && session?.bot) {
      try {
        const ch = await session.bot.getChannel(key.channelId, session?.guildId);
        channelName = ch?.name || null;
      } catch {
        /* ignore */
      }
    }
    if (!channelName) channelName = `${key.platform}:${key.channelId}`;
    const newEnv: Environment & { updatedAt: string } = {
      type: (session?.isDirect ?? false) ? "private" : "group",
      id,
      name: channelName,
      platform: key.platform,
      channelId: key.channelId,
      updatedAt: new Date().toISOString(),
    };
    this.db.set(id, newEnv).commit();
    return newEnv;
  }
}
