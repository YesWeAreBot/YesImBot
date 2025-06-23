import { Context, Service, Session } from "koishi";
import { LRUCache } from "lru-cache";
import { Services } from "../types";
import { PlatformServiceConfig } from "./config";
import { IPlatformHelper } from "./platform.interface";
import { RichGuildInfo } from "./types";

interface CachedData<T> {
    data: T;
    timestamp: number;
}

declare module "koishi" {
    interface Context {
        [Services.Platform]: PlatformService;
    }
}

export class PlatformService extends Service<PlatformServiceConfig> {
    // 助手注册表
    private helpers = new Map<string, IPlatformHelper>();
    private guildCache: LRUCache<string, CachedData<RichGuildInfo>>;

    constructor(ctx: Context, config: PlatformServiceConfig) {
        super(ctx, Services.Platform, true);
        this.config = config;
        this.guildCache = new LRUCache({
            max: config.Cache.MaxSize,
            ttl: config.Cache.TTL * 60 * 1000,
        });
    }

    /**
     * 注册一个平台助手。
     * 供其他插件调用，以扩展 PlatformService 的能力。
     * @param helper 平台助手的实例
     */
    public registerHelper(helper: IPlatformHelper): void {
        const name = helper.platformName;
        if (this.helpers.has(name)) {
            this.ctx.logger.warn(`Platform helper for '${name}' is already registered. Overwriting.`);
        }
        this.helpers.set(name, helper);
        this.ctx.logger.info(`Platform helper for '${name}' registered.`);
    }

    public async getGuildInfo(session: Session, guildId: string): Promise<RichGuildInfo | null> {
        const { platform } = session.bot;
        const cacheKey = `${platform}:${guildId}`;
        const cached = this.guildCache.get(cacheKey);
        if (cached) return cached.data;

        // 1. 根据平台名称，从注册表中获取对应的助手
        const helper = this.helpers.get(platform);
        if (!helper) {
            this.ctx.logger.warn(`No platform helper found for '${platform}'.`);
            return await session.bot.getGuild(guildId);
        }

        try {
            // 2. 调用助手的具体实现
            const guildInfo = await helper.getRichGuildInfo(session, guildId);
            if (guildInfo) {
                this.guildCache.set(cacheKey, { data: guildInfo, timestamp: Date.now() });
            }
            return guildInfo;
        } catch (error) {
            this.ctx.logger.warn(`Helper for '${platform}' failed to get guild info:`, error);
            return null;
        }
    }
}
