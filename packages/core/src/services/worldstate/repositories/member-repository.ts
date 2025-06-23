import { Bot, Context } from "koishi";
import { LRUCache } from "lru-cache";
import { Member, PlatformUser } from "../interfaces";
import { TableName } from "../model";

// 定义缓存中存储的对象结构
interface CachedUser {
    user: PlatformUser & { nick?: string; role?: string };
    timestamp: number;
}

/**
 * 成员仓储 (Member Repository)
 *
 * 职责:
 * - 封装所有与成员数据相关的数据库和平台API交互。
 * - 提供将平台用户ID(pid)高效“水合”(hydrate)成完整领域对象`Member`的方法。
 * - 管理成员的活动状态更新。
 */
export class MemberRepository {
    private userCache: LRUCache<string, CachedUser>; // 声明缓存实例

    constructor(private ctx: Context) {
        // 初始化缓存
        // 缓存最多1000个用户，每个用户缓存5分钟 (300,000毫秒)
        // 这些值应该来自配置，暂时硬编码
        this.userCache = new LRUCache<string, CachedUser>({
            max: 1000,
            ttl: 5 * 60 * 1000,
        });
    }

    /**
     * 根据一组平台用户ID，批量地、高效地构建完整的 Member 对象。
     * 这是仓储层的核心方法，通过批量处理避免了 N+1 查询问题。
     * @param platform 平台名称
     * @param channelId 频道ID，用于获取频道相关的成员信息
     * @param pids 平台用户ID (pid) 的数组
     * @returns 返回一个以 pid 为键，完整 Member 对象为值的 Map
     */
    public async hydrateMembers(platform: string, guildId: string, channelId: string, pids: string[]): Promise<Map<string, Member>> {
        const uniquePids = [...new Set(pids)];
        if (uniquePids.length === 0) {
            return new Map();
        }

        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) {
            this.ctx.logger.warn(`No bot found for platform: ${platform}`);
            return new Map();
        }

        // --- 步骤 1: 批量获取平台实时信息 ---
        const platformUsers = await this.getPlatformUsers(bot, guildId, uniquePids);

        // --- 步骤 2: 批量获取 Koishi 内部 user.id ---
        const bindingRecords = await this.ctx.database.get("binding", { platform, pid: uniquePids });
        const koishiUserIds = bindingRecords.map((b) => b.bid);
        const pidToBidMap = new Map(bindingRecords.map((b) => [b.pid, b.bid]));

        // --- 步骤 3: 批量获取我们自定义的成员附加信息 ---
        const memberDataRecords = await this.ctx.database.get(TableName.Members, {
            uid: koishiUserIds,
            platform,
            channelId,
        });
        const bidToMemberDataMap = new Map(memberDataRecords.map((m) => [m.uid, m]));

        // --- 步骤 4: 融合数据，构建最终的 Member 对象 ---
        const resultMap = new Map<string, Member>();
        for (const pid of uniquePids) {
            const platformUser = platformUsers.get(pid);
            if (!platformUser) continue;

            const bid = pidToBidMap.get(pid);
            const memberData = bid ? bidToMemberDataMap.get(bid) : undefined;

            const finalNick = memberData?.nickOverride || platformUser.nick || platformUser.name;
            const finalRole = memberData?.roleOverride || platformUser.role;

            resultMap.set(pid, {
                ...platformUser,
                nick: finalNick,
                role: finalRole,
            });
        }
        return resultMap;
    }

    /**
     * 更新成员的最后活跃时间。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @param pid 平台用户ID
     */
    public async updateMemberActivity(platform: string, channelId: string, pid: string): Promise<void> {
        await this.ctx.database.upsert(TableName.Members, [
            {
                pid,
                platform,
                channelId,
                lastActive: new Date(),
            },
        ]);
    }

    /**
     * 内部辅助方法：批量从平台API或缓存获取用户信息。
     */
    private async getPlatformUsers(
        bot: Bot,
        guildId: string,
        pids: string[]
    ): Promise<Map<string, PlatformUser & { nick?: string; role?: string }>> {
        const platformUserMap = new Map<string, PlatformUser & { nick?: string; role?: string }>();
        const pidsToFetch: string[] = [];

        // --- 步骤 1: 尝试从缓存中获取数据 ---
        for (const pid of pids) {
            const cacheKey = `${bot.platform}:${guildId}:${pid}`;
            const cached = this.userCache.get(cacheKey);
            if (cached) {
                platformUserMap.set(pid, cached.user);
            } else {
                pidsToFetch.push(pid);
            }
        }

        // 如果所有用户都在缓存中，直接返回
        if (pidsToFetch.length === 0) {
            return platformUserMap;
        }

        this.ctx.logger.info(`Cache miss for ${pidsToFetch.length} users. Fetching from platform...`);

        // --- 步骤 2: 对未命中缓存的用户进行批量API调用 ---
        const promises = pidsToFetch.map(async (pid) => {
            try {
                // ... (获取 memberInfo 和 userInfo 的逻辑保持不变) ...
                const memberInfo = await bot.getGuildMember(guildId, pid).catch(() => null);
                // ...
                const userInfo = await bot.getUser(pid);
                const user = memberInfo ? { ...memberInfo.user, nick: memberInfo.name } : userInfo;

                // --- 步骤 3: 将获取到的新数据存入缓存 ---
                const cacheKey = `${bot.platform}:${guildId}:${pid}`;
                this.userCache.set(cacheKey, { user, timestamp: Date.now() });

                return user;
            } catch (error) {
                // ... (错误处理逻辑保持不变) ...
                return { id: pid, name: `未知用户(${pid})` };
            }
        });

        const results = await Promise.all(promises);
        for (const user of results) {
            if (user) {
                platformUserMap.set(user.id, user);
            }
        }
        return platformUserMap;
    }
}
