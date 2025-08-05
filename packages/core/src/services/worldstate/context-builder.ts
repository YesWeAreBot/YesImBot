import { ChannelDescriptor } from "@/agent";
import { Services, TableName } from "@/shared/constants";
import { formatDate } from "@/shared/utils";
import { Bot, Context, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { DialogueSegmentData, MessageData, SystemEventData } from "./database-models";
import {
    ClosedDialogueSegment,
    ContextualMessage,
    FoldedDialogueSegment,
    GuildMember,
    History,
    PendingDialogueSegment,
    SummarizedDialogueSegment,
    WorldState,
} from "./types";
import { UserRecallManager } from "./user-recall-manager";

// =================================================================================
// #region 主类：ContextBuilder
// =================================================================================

export class ContextBuilder {
    private logger: Logger;

    private dataProvider: ContextDataProvider;
    private recallManager: UserRecallManager;

    constructor(
        private ctx: Context,
        private config: HistoryConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[上下文构建]");

        // 初始化辅助工具

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
        const [history, user] = await Promise.all([this.build(channel), this.dataProvider.getUserInfo(bot, userId, platform)]);

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
        const [history, channelInfo] = await Promise.all([this.build(channel), this.dataProvider.getChannelInfo(bot, id, platform)]);

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
        return [history.pending, ...history.closed, history.folded].filter(Boolean).flatMap((segment) => segment.dialogue);
    }

    /**
     * 从数据库获取并构建完整的对话历史记录
     */
    public async build(channel: ChannelDescriptor): Promise<History> {
        const { platform, id: channelId } = channel;

        // 1. 获取各状态的对话片段
        const [openSegments, rawClosedSegments, rawFoldedSegments, summarizedSegments] = await Promise.all([
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "open" }),
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "closed" }),
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "folded" }),
            this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "summarized" }),
        ]);

        const pendingSegment = openSegments[0];
        const closedSegments = rawClosedSegments
            .sort((a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime())
            .slice(0, this.config.fullContextSegmentCount)
            .reverse();
        const foldedSegments = rawFoldedSegments
            .sort((a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime())
            .slice(0, this.config.summarization.triggerCount)
            .reverse();
        const summarizedSegment = summarizedSegments.sort((a, b) => b.startTimestamp.getTime() - a.startTimestamp.getTime())[0];

        // 2. 批量获取所有需要内容的消息和事件
        const segmentsNeedingContent = [...(pendingSegment ? [pendingSegment] : []), ...closedSegments, ...foldedSegments];
        const segmentIds = segmentsNeedingContent.map((s) => s.id);

        const [allMessages, allSystemEvents] =
            segmentIds.length > 0
                ? await Promise.all([
                      this.ctx.database.get(TableName.Messages, { sid: { $in: segmentIds } }),
                      this.ctx.database.get(TableName.SystemEvents, { sid: { $in: segmentIds } }),
                  ])
                : [[], []];

        const messagesBySegment = this.groupDataBySegmentId(allMessages);
        const eventsBySegment = this.groupDataBySegmentId(allSystemEvents);

        // 3. 并行构建对话片段对象
        const [pending, closed, folded, summarized] = await Promise.all([
            pendingSegment ? this.buildPendingSegment(pendingSegment, messagesBySegment, eventsBySegment) : undefined,
            Promise.all(closedSegments.map((r) => this.buildClosedSegment(r, messagesBySegment, eventsBySegment))),
            foldedSegments.length > 0 ? this.buildFoldedSegment(foldedSegments, messagesBySegment, eventsBySegment) : undefined,
            summarizedSegment ? this.buildSummarizedSegment(summarizedSegment) : undefined,
        ]);

        return { pending, closed, folded, summarized };
    }

    private groupDataBySegmentId<T extends { sid: string }>(data: T[]): Map<string, T[]> {
        const map = new Map<string, T[]>();
        data.forEach((item) => {
            if (!map.has(item.sid)) {
                map.set(item.sid, []);
            }
            map.get(item.sid)!.push(item);
        });
        return map;
    }

    private buildPendingSegment(
        segmentRecord: DialogueSegmentData,
        messagesBySegment: Map<string, MessageData[]>,
        eventsBySegment: Map<string, SystemEventData[]>
    ): PendingDialogueSegment {
        const messageRecords = messagesBySegment.get(segmentRecord.id) || [];
        const systemEventRecords = eventsBySegment.get(segmentRecord.id) || [];

        return {
            type: "dialogue-segment",
            id: segmentRecord.id,
            platform: segmentRecord.platform,
            channelId: segmentRecord.channelId,
            guildId: segmentRecord.guildId,
            status: "open",
            startTimestamp: segmentRecord.startTimestamp,
            dialogue: this.buildDialogueMessages(messageRecords),
            systemEvents: systemEventRecords.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                date: formatDate(record.timestamp, "MM-DD"),
                payload: record.payload,
            })),
        };
    }

    private buildClosedSegment(
        record: DialogueSegmentData,
        messagesBySegment: Map<string, MessageData[]>,
        eventsBySegment: Map<string, SystemEventData[]>
    ): ClosedDialogueSegment {
        const messageRecords = messagesBySegment.get(record.id) || [];
        const systemEventRecords = eventsBySegment.get(record.id) || [];

        return {
            type: "dialogue-segment",
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            guildId: record.guildId,
            status: "closed",
            startTimestamp: record.startTimestamp,
            endTimestamp: record.endTimestamp,
            agentTurn: record.agentTurn,
            dialogue: this.buildDialogueMessages(messageRecords),
            systemEvents: systemEventRecords.map((eventRecord) => ({
                id: eventRecord.id,
                type: eventRecord.type,
                timestamp: eventRecord.timestamp,
                date: formatDate(eventRecord.timestamp, "MM-DD"),
                payload: eventRecord.payload,
            })),
        };
    }

    private buildFoldedSegment(
        foldedSegments: DialogueSegmentData[],
        messagesBySegment: Map<string, MessageData[]>,
        eventsBySegment: Map<string, SystemEventData[]>
    ): FoldedDialogueSegment {
        const allMessages = foldedSegments.flatMap((s) => messagesBySegment.get(s.id) || []);
        const allSystemEvents = foldedSegments.flatMap((s) => eventsBySegment.get(s.id) || []);

        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        allSystemEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return {
            type: "dialogue-segment",
            id: foldedSegments[0].id,
            platform: foldedSegments[0].platform,
            channelId: foldedSegments[0].channelId,
            guildId: foldedSegments[0].guildId,
            status: "folded",
            dialogue: this.buildDialogueMessages(allMessages),
            systemEvents: allSystemEvents.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                date: formatDate(record.timestamp, "MM-DD"),
                payload: record.payload,
            })),
            startTimestamp: foldedSegments[0].startTimestamp,
            endTimestamp: foldedSegments[foldedSegments.length - 1].endTimestamp,
        };
    }

    private buildSummarizedSegment(record: DialogueSegmentData): SummarizedDialogueSegment {
        return {
            type: "dialogue-segment",
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            guildId: record.guildId,
            status: "summarized",
            summary: record.summary,
            startTimestamp: record.startTimestamp,
            endTimestamp: record.endTimestamp,
        };
    }

    private buildDialogueMessages(messageRecords: MessageData[]): ContextualMessage[] {
        const quotedMsgIds = new Set(messageRecords.filter((m) => m.quoteId).map((m) => m.quoteId));
        return messageRecords.map((record) => ({
            id: record.id,
            content: record.content,
            timestamp: record.timestamp,
            date: formatDate(record.timestamp, "MM-DD"),
            time: formatDate(record.timestamp, "HH:mm"),
            quoted: quotedMsgIds.has(record.id),
            quoteId: record.quoteId,
            sender: { id: record.sender.id, name: record.sender.name, roles: record.sender.roles },
        }));
    }
}

// =================================================================================
// #region 辅助类：ContextDataProvider (数据获取与缓存)
// =================================================================================

class ContextDataProvider {
    constructor(
        private ctx: Context,
        private logger: Logger
    ) {}

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

    public async getMembersFromHistory(bot: Bot, history: History, platform: string, guildId: string): Promise<GuildMember[]> {
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
