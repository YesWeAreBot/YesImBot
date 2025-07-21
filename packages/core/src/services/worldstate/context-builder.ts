import { ChannelDescriptor } from "@/agent";
import { Bot, Context, Logger } from "koishi";
import { UserProfile } from "../memory";
import { Services, TableName } from "../types";
import { CacheKeyPrefix, CacheManager } from "./cache-manager";
import { HistoryConfig } from "./config";
import { HistoryBuilder } from "./history-builder";
import {
    ContextualMessage,
    GuildMember,
    History,
    WorldState
} from "./interfaces";
import { UserRecallManager } from "./user-recall-manager";

// =================================================================================
// #region 主类：ContextBuilder
// =================================================================================

export class ContextBuilder {
    private logger: Logger;
    private cacheManager: CacheManager;
    private historyBuilder: HistoryBuilder;
    private dataProvider: ContextDataProvider;
    private recallManager: UserRecallManager;

    constructor(private ctx: Context, private config: HistoryConfig) {
        this.logger = ctx[Services.Logger].getLogger("[上下文构建]");

        // 初始化辅助工具
        this.cacheManager = new CacheManager();
        this.historyBuilder = new HistoryBuilder(ctx, config);
        this.dataProvider = new ContextDataProvider(ctx, this.cacheManager, this.logger);
        this.recallManager = new UserRecallManager(ctx, config, this.logger, this.cacheManager);
    }

    /**
     * 构建私聊频道的上下文
     */
    public async buildPrivateChannelContext(bot: Bot, channel: ChannelDescriptor): Promise<WorldState> {
        const { platform, id } = channel;
        const userId = id.replace("private:", "");

        // 1. 并行获取历史记录和用户信息
        const [history, user] = await Promise.all([
            this.historyBuilder.build(channel),
            this.dataProvider.getUserInfo(bot, userId, platform),
        ]);

        const userName = user?.name || user?.nick || userId;
        const members: GuildMember[] = [
            {
                pid: bot.selfId,
                name: bot.user.name,
                nick: bot.user.nick || bot.user.name,
                roles: ["assistant", "bot"],
                isSelf: true,
            },
            { pid: userId, name: userName, nick: user?.nick || userName, roles: ["user"], isSelf: false },
        ];

        // 2. 根据历史记录召回相关用户画像
        const allMessages = this.getAllMessagesFromHistory(history);
        const userIds = await this.recallManager.recallForPrivateContext(allMessages, userId);
        const profiles = await this.dataProvider.getUserProfiles(userIds);

        // 3. 组装最终的世界状态
        return {
            users: profiles.map((p) => ({ id: p.userId, name: p.userName, description: p.content })),
            channel: {
                id,
                platform,
                name: `与 ${userName} 的私聊`,
                type: "private",
                meta: {},
                members,
                history,
            },
        };
    }

    /**
     * 构建群聊频道的上下文
     */
    public async buildGuildChannelContext(bot: Bot, channel: ChannelDescriptor): Promise<WorldState> {
        const { platform, id } = channel;

        // 1. 并行获取历史记录和频道信息
        const [history, channelInfo] = await Promise.all([
            this.historyBuilder.build(channel),
            this.dataProvider.getChannelInfo(bot, id, platform),
        ]);

        if (!channelInfo) {
            return {
                users: [],
                channel: { id, platform, name: `Channel ${id}`, type: "guild", meta: {}, members: [], history },
            };
        }

        // 2. 根据历史记录召回用户、获取成员和用户画像
        const allMessages = this.getAllMessagesFromHistory(history);
        const [userIds, members] = await Promise.all([
            this.recallManager.recallForGuildContext(allMessages),
            this.dataProvider.getMembersFromHistory(bot, history, platform, channelInfo.guildId || id),
        ]);
        const profiles = await this.dataProvider.getUserProfiles(userIds);

        // 3. 组装最终的世界状态
        return {
            users: profiles.map((p) => ({ id: p.userId, name: p.userName, description: p.content })),
            channel: {
                id,
                platform,
                name: channelInfo.name,
                type: "guild",
                meta: { ...channelInfo },
                members,
                history,
            },
        };
    }

    private getAllMessagesFromHistory(history: History): ContextualMessage[] {
        return [history.pending, ...history.closed, history.folded]
            .filter(Boolean)
            .flatMap((segment) => segment.dialogue);
    }
}

// =================================================================================
// #region 辅助类：ContextDataProvider (数据获取与缓存)
// =================================================================================

class ContextDataProvider {
    constructor(private ctx: Context, private cacheManager: CacheManager, private logger: Logger) {}

    public async getUserInfo(bot: Bot, userId: string, platform: string): Promise<any> {
        const cacheKey = `${platform}:${userId}`;
        const cachedUser = this.cacheManager.get<any>(CacheKeyPrefix.USER_INFO, cacheKey);
        if (cachedUser) return cachedUser;

        try {
            const user = await bot.getUser(userId);
            if (user) {
                this.cacheManager.set(CacheKeyPrefix.USER_INFO, cacheKey, user);
                return user;
            }
        } catch (error) {
            this.logger.warn(`获取用户信息失败，将使用基础信息 | 用户: ${platform}:${userId}`);
        }
        return null;
    }

    public async getChannelInfo(bot: Bot, channelId: string, platform: string): Promise<any> {
        const cacheKey = `${platform}:${channelId}`;
        const cachedChannel = this.cacheManager.get<any>(CacheKeyPrefix.CHANNEL_INFO, cacheKey);
        if (cachedChannel) return cachedChannel;

        try {
            const channelInfo = await bot.getChannel(channelId);
            if (channelInfo) {
                this.cacheManager.set(CacheKeyPrefix.CHANNEL_INFO, cacheKey, channelInfo);
                return channelInfo;
            }
        } catch (error) {
            this.logger.warn(`获取频道信息失败，将使用基础信息 | 频道: ${platform}:${channelId}`);
        }
        return null;
    }

    public async getUserProfiles(userIds: string[]): Promise<UserProfile[]> {
        if (userIds.length === 0) return [];

        const profiles: UserProfile[] = [];
        const missingUserIds: string[] = [];

        for (const userId of userIds) {
            const cachedProfile = this.cacheManager.get<UserProfile>(CacheKeyPrefix.USER_PROFILES, userId);
            if (cachedProfile) {
                profiles.push(cachedProfile);
            } else {
                missingUserIds.push(userId);
            }
        }

        if (missingUserIds.length > 0) {
            const missingProfiles = await this.ctx.database.get(TableName.UserProfiles, {
                userId: { $in: missingUserIds },
                isDeleted: false,
            });
            for (const profile of missingProfiles) {
                this.cacheManager.set(CacheKeyPrefix.USER_PROFILES, profile.userId, profile);
                profiles.push(profile);
            }
        }
        return profiles;
    }

    public async getMembersFromHistory(
        bot: Bot,
        history: History,
        platform: string,
        guildId: string
    ): Promise<GuildMember[]> {
        const memberIds = new Set<string>();
        [history.pending, ...history.closed, history.folded]
            .filter(Boolean)
            .flatMap((segment) => segment.dialogue)
            .forEach((message) => memberIds.add(message.sender.id));

        const humanMembers = await this.getMemberList(platform, guildId, Array.from(memberIds));

        const botAsMember: GuildMember = {
            pid: bot.selfId,
            name: bot.user.name,
            nick: bot.user.nick || bot.user.name,
            roles: ["assistant", "bot"],
            isSelf: true,
        };

        return [botAsMember, ...humanMembers];
    }

    private async getMemberList(platform: string, guildId: string, memberIds: string[]): Promise<GuildMember[]> {
        if (memberIds.length === 0) return [];

        const cacheKey = `${platform}:${guildId}`;
        let cachedMembers = this.cacheManager.get<Map<string, GuildMember>>(CacheKeyPrefix.MEMBER_LIST, cacheKey);
        if (!cachedMembers) {
            const allMembers = await this.ctx.database.get(TableName.Members, { platform, guildId });
            cachedMembers = new Map(allMembers.map((member) => [member.pid, member as GuildMember]));
            this.cacheManager.set(CacheKeyPrefix.MEMBER_LIST, cacheKey, cachedMembers);
        }

        const result: GuildMember[] = [];
        const missingMemberIds: string[] = [];

        for (const memberId of memberIds) {
            const member = cachedMembers.get(memberId);
            if (member) {
                result.push(member);
            } else {
                missingMemberIds.push(memberId);
            }
        }

        if (missingMemberIds.length > 0) {
            const missingMembers = await this.ctx.database.get(TableName.Members, {
                platform,
                guildId,
                pid: { $in: missingMemberIds },
            });
            for (const member of missingMembers) {
                const guildMember = member as GuildMember;
                cachedMembers.set(member.pid, guildMember);
                result.push(guildMember);
            }
            this.cacheManager.set(CacheKeyPrefix.MEMBER_LIST, cacheKey, cachedMembers);
        }
        return result;
    }
}
