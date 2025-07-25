import { ChannelDescriptor } from "@/agent";
import { Services, TableName } from "@/shared/constants";
import { Bot, Context, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { HistoryBuilder } from "./history-builder";
import { ContextualMessage, GuildMember, History, WorldState } from "./types";
import { UserRecallManager } from "./user-recall-manager";

// =================================================================================
// #region 主类：ContextBuilder
// =================================================================================

export class ContextBuilder {
    private logger: Logger;
    private historyBuilder: HistoryBuilder;
    private dataProvider: ContextDataProvider;
    private recallManager: UserRecallManager;

    constructor(private ctx: Context, private config: HistoryConfig) {
        this.logger = ctx[Services.Logger].getLogger("[上下文构建]");

        // 初始化辅助工具
        this.historyBuilder = new HistoryBuilder(ctx, config);
        this.dataProvider = new ContextDataProvider(ctx, this.logger);
        this.recallManager = new UserRecallManager(ctx, config, this.logger);
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
        let uniqueUserIds = new Set(userIds);
        uniqueUserIds.delete(bot.selfId);
        const profiles = await this.recallManager.getUserProfiles(Array.from(uniqueUserIds), id);

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
        const allMessages = this.getAllMessagesFromHistory(history).slice(-this.config.maxMessages);
        const [userIds, members] = await Promise.all([
            this.recallManager.recallForGuildContext(allMessages),
            this.dataProvider.getMembersFromHistory(bot, history, platform, channelInfo.guildId || id),
        ]);
        let uniqueUserIds = new Set(userIds);
        uniqueUserIds.delete(bot.selfId);
        const profiles = await this.recallManager.getUserProfiles(Array.from(uniqueUserIds), id);

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
    constructor(private ctx: Context, private logger: Logger) {}

    public async getUserInfo(bot: Bot, userId: string, platform: string): Promise<any> {
        try {
            const user = await bot.getUser(userId);
            if (user) {
                return user;
            }
        } catch (error) {
            this.logger.warn(`获取用户信息失败，将使用基础信息 | 用户: ${platform}:${userId}`);
        }
        return null;
    }

    public async getChannelInfo(bot: Bot, channelId: string, platform: string): Promise<any> {
        try {
            const channelInfo = await bot.getChannel(channelId);
            if (channelInfo) {
                return channelInfo;
            }
        } catch (error) {
            this.logger.warn(`获取频道信息失败，将使用基础信息 | 频道: ${platform}:${channelId}`);
        }
        return null;
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

        const result: GuildMember[] = [];
        const missingMemberIds: string[] = [];

        for (const memberId of memberIds) {
            missingMemberIds.push(memberId);
        }

        if (missingMemberIds.length > 0) {
            const missingMembers = await this.ctx.database.get(TableName.Members, {
                platform,
                guildId,
                pid: { $in: missingMemberIds },
            });
            for (const member of missingMembers) {
                const guildMember = member as GuildMember;
                result.push(guildMember);
            }
        }
        return result;
    }
}
