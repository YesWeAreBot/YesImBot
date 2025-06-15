import { Context, randomId, Service, Session } from "koishi";
import { AgentResponse, Channel, MemberSummary, WorldState } from "./interfaces";
import { AgentResponseData, ChannelEventData, TurnData } from "./model";
import { MemberRepository } from "./repositories/MemberRepository";
import { TurnRepository } from "./repositories/TurnRepository";

declare module "koishi" {
    interface Context {
        "yesimbot.data": DataManager;
    }
}

export class DataManager extends Service {
    public readonly members: MemberRepository;
    public readonly turns: TurnRepository;

    constructor(ctx: Context) {
        super(ctx, "yesimbot.data", true);
        // 应用所有数据库模型定义
        ctx.plugin(require("./model"));

        // 初始化所有 repositories
        this.members = new MemberRepository(ctx);
        this.turns = new TurnRepository(ctx, this.members);
    }

    /**
     * 获取一个频道的完整运行时对象
     */
    async getFullChannel(platform: string, channelId: string): Promise<Channel | null> {
        // 1. 获取基础频道数据
        const [channelData] = await this.ctx.database.get("channel", { platform, id: channelId });
        if (!channelData) return null;

        // 2. 使用 Repositories 获取关联数据
        const members = await this.members.getFullMembers(platform, channelId);
        const history = await this.turns.getFullTurns(platform, channelId);

        // 3. 组装 MemberSummary
        const memberSummary: MemberSummary = {
            total_count: channelData.totalMemberCount,
            recent_active_members_count: channelData.recentActiveCount,
            // online_count 是一个纯运行时状态，无法从数据库直接获取
            // 通常需要通过适配器API实时查询，或从心跳/presence事件中维护
            online_count: 0,
        };

        // 4. 组合成最终的 Channel 对象
        return {
            id: channelData.id,
            platform: channelData.platform,
            name: channelData.name,
            type: channelData.type,
            meta: {
                description: channelData.description,
            },
            members,
            history,
            memberSummary,
        };
    }

    /**
     * 获取当前的世界状态
     */
    async getWorldState(): Promise<WorldState> {
        const activeThreshold = new Date(Date.now() - 1 * 60 * 60 * 1000);

        const allChannels = await this.ctx.database.get("channel", {});

        const activeChannelPromises: Promise<Channel>[] = [];
        const inactiveChannelPromises: Promise<Channel>[] = [];

        for (const chan of allChannels) {
            const promise = this.getFullChannel(chan.platform, chan.id);
            if (chan.lastActivityAt > activeThreshold) {
                activeChannelPromises.push(promise);
            } else {
                inactiveChannelPromises.push(promise);
            }
        }

        return {
            timestamp: new Date().toISOString(),
            activeChannels: (await Promise.all(activeChannelPromises)).filter((c) => c !== null),
            inactiveChannels: (await Promise.all(inactiveChannelPromises)).filter((c) => c !== null),
        };
    }

    /**
     * 开始一个新的对话回合 (Turn)。
     * @param platform - 平台
     * @param channelId - 频道ID
     * @returns 返回新创建的 TurnData 对象。
     */
    async startNewTurn(platform: string, channelId: string): Promise<TurnData> {
        const newTurn: Partial<TurnData> = {
            id: randomId(),
            platform,
            channelId,
            status: "new",
            summary: "",
            startTimestamp: new Date(),
            endTimestamp: null, // 尚未结束
        };
        return await this.ctx.database.create("turns", newTurn);
    }

    /**
     * 向指定的 Turn 添加一条消息事件。
     * @param turnId - 目标 Turn 的 ID
     * @param session - 触发消息的 Koishi Session 对象
     * @returns 返回新创建的 ChannelEventData 对象。
     */
    async addMessageEvent(turnId: string, session: Session): Promise<ChannelEventData> {
        return await this.ctx.database.create("channel_events", {
            turnId,
            type: "message_sent",
            timestamp: new Date(session.timestamp),
            data: {
                messageId: session.messageId,
                senderId: session.userId, // 这是平台ID (pid)
                content: session.content,
            },
        });
    }

    /**
     * 向指定的 Turn 添加一个通用事件。
     * @param turnId - 目标 Turn 的 ID
     * @param type - 事件类型
     * @param data - 事件的特定数据
     * @returns 返回新创建的 ChannelEventData 对象。
     */
    async addGenericEvent(turnId: string, type: string, data: object): Promise<ChannelEventData> {
        return await this.ctx.database.create("channel_events", {
            turnId,
            type,
            timestamp: new Date(),
            data,
        });
    }

    /**
     * 结束一个对话回合。
     * @param turnId - 要结束的 Turn 的 ID
     * @param summary - (可选) 对该回合的AI摘要
     */
    async endTurn(turnId: string, summary?: string): Promise<void> {
        await this.ctx.database.upsert("turns", [
            {
                id: turnId,
                status: summary ? "summarized" : "full",
                summary: summary,
                endTimestamp: new Date(),
            },
        ]);
    }

    /**
     * 向指定的 Turn 添加一个完整的 Agent 响应。
     * @param turnId - 目标 Turn 的 ID
     * @param response - AgentResponse 业务对象
     * @returns 返回新创建的 AgentResponseData 对象。
     */
    async addAgentResponse(turnId: string, response: AgentResponse): Promise<AgentResponseData> {
        const { thoughts, actions, observations } = response;
        return await this.ctx.database.create("agent_responses", {
            turnId,
            thoughts,
            actions,
            observations,
        });
    }

    /**
     * 根据 Session "顺便" 更新频道信息。
     * 这应该在每次收到消息时调用。
     * @param session - Koishi Session 对象
     */
    async touchChannel(session: Session): Promise<void> {
        // session.guild 包含适配器获取的最新群组信息
        //@ts-ignore
        const channelName = session.guild?.name ?? session.channel.name;

        await this.ctx.database.upsert("channel", [
            {
                id: session.channelId,
                platform: session.platform,
                // 更新频道名称，以防它被修改
                name: channelName,
                // 更新最后活动时间
                lastActivityAt: new Date(),
            },
        ]);
    }

    /**
     * 当成员列表发生变化时，更新频道的成员计数值。
     * 这应该在 'guild-member-added' 或 'guild-member-removed' 事件中调用。
     * @param guildId - 频道/群组 ID
     * @param platform - 平台
     */
    async updateChannelMemberCount(guildId: string, platform: string) {
        // 尝试从适配器获取最新的成员总数
        const bot = this.ctx.bots[`${platform}:${this.ctx.config.selfId}`];
        let totalCount = 0;
        try {
            // 注意: getGuild 方法和返回的成员数取决于具体适配器
            const guild = await bot?.getGuild(guildId);
            //@ts-ignore
            totalCount = guild?.memberCount ?? 0;
        } catch (error) {
            // 如果API调用失败，可以从我们自己的 members 表中计数作为备用方案
            //@ts-ignore
            totalCount = await this.ctx.database.count("members", { channelId: guildId, platform });
            this.ctx.logger("data").warn(`Failed to fetch member count for ${guildId}, using fallback count: ${totalCount}`);
        }

        await this.ctx.database.upsert("channel", [
            {
                id: guildId,
                platform: platform,
                totalMemberCount: totalCount,
            },
        ]);
    }
}
