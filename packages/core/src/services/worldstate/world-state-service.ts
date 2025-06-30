import { $, Context, Random, Service, Session } from "koishi";
import { Services } from "../types";
import { WorldStateConfig } from "./config";
import { AgentTurn, Channel, DialogueSegment, WorldState } from "./interfaces";
import { DialogueSegmentData, TableName } from "./model";

// 在 Koishi 的 Context 接口上声明我们的服务，以获得完整的类型提示
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }

    interface Events {
        /** 当对话片段有更新时触发 */
        "worldstate:segment-updated"(session: Session, segment: DialogueSegment): void;
    }
}

/**
 * WorldState 服务
 */
export class WorldStateService extends Service<WorldStateConfig> {
    private disposer: (() => boolean)[] = [];

    constructor(ctx: Context, config: WorldStateConfig) {
        super(ctx, Services.WorldState, true);
        this.config = config;

        // 应用所有数据库模型定义
        ctx.plugin(require("./model"));
    }

    /**
     * Koishi 服务生命周期方法，在插件启动时调用。
     * 我们在这里注册所有的事件监听器。
     */
    protected start(): void {
        this.ctx.logger.info("WorldState Service started, listening to events...");

        // 监听所有消息事件
        this.disposer.push(this.ctx.on("message", (session) => this.onMessage(session), true));

        this.ctx.on("worldstate:segment-updated", (session, segment) => {});
    }

    // --- 事件处理器 ---
    /**
     * 消息处理流程
     * 1. 获取或创建当前开放的对话片段
     * 2. 准备事件负载
     * 3. 持久化事件
     * 4. 触发 worldstate:segment-updated 事件，将构造好的 DialogueSegment 对象传递给监听器
     */
    private async onMessage(session: Session): Promise<void> {
        // 更新频道及成员信息

        // 内置用户表
        const [binding] = await this.ctx.database.get("binding", { platform: session.platform, pid: session.userId });
        const [kUser] = await this.ctx.database.get("user", { id: binding.bid });

        // 只有群聊环境更新
        // 主要是确认哪个群组中包含哪些用户
        // 其他信息可以通过平台适配器实时获取
        if (session.guildId) {
            await this.ctx.database.upsert(TableName.Members, [
                {
                    uid: kUser.id,
                    pid: session.userId,
                    platform: session.platform,
                    channelId: session.guildId,
                    name: session.author.name,
                    nick: session.author.nick,
                    roles: session.author.roles,
                    avatar: session.author.avatar,
                    title: session.author.title,
                    joinedAt: new Date(session.author.joinedAt),
                    lastActive: new Date(),
                },
            ]);
        }

        // 获取或创建当前开放的对话片段
        const segmentRecord = await this.getOrCreateOpenSegment(session.platform, session.channelId);

        // 消息入库
        await this.ctx.database.create(TableName.Messages, {
            id: session.messageId,
            sid: segmentRecord.id,
            channelId: session.channelId,
            platform: session.platform,
            sender: {
                id: session.userId,
                name: session.author.name,
                nick: session.author.nick,
                roles: session.author.roles,
            },
            timestamp: new Date(session.timestamp),
            content: session.content,
            quoteId: session.quote?.id,
        });

        const dialogueSegment = await this.constructFullSegmentById(session.platform, session.channelId, segmentRecord.id);

        // 触发 worldstate:segment-updated 事件
        this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
    }

    public async getWorldState(allowedChannels: { Platform: string; Id: string }[]): Promise<WorldState> {
        const activeChannels = await Promise.all(
            allowedChannels.map(({ Platform, Id }) => {

                return this.buildFullContextForChannel(Platform, Id);
            })
        );

        return {
            timestamp: new Date().toISOString(),
            activeChannels: activeChannels,
            inactiveChannels: [],
        };
    }

    async buildFullContextForChannel(platform: string, channelId: string): Promise<Channel> {
        const memberRecords = await this.ctx.database.get(TableName.Members, { platform, channelId });

        const dialogueSegmentRecords = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId })
            .orderBy("timestamp", "desc")
            // .limit(10)
            .execute();

        const dialogueSegments = await Promise.all(
            dialogueSegmentRecords.map((record) => this.constructFullSegmentById(record.platform, record.channelId, record.id))
        );

        const agentTurnRecords = await this.ctx.database
            .select(TableName.AgentTurns)
            .where({ sid: dialogueSegmentRecords.map((record) => record.id) })
            .orderBy("timestamp", "desc")
            // .limit(10)
            .execute();

        const agentTurns = await Promise.all(
            agentTurnRecords.map((record) => this.constructFullAgentTurnById(record.platform, record.channelId, record.id))
        );

        // 按时间戳合并消息和 Agent 回合
        const history: (DialogueSegment | AgentTurn)[] = [...dialogueSegments, ...agentTurns]
            .filter(Boolean)
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return {
            id: channelId,
            name: channelId,
            type: "guild",
            platform: platform,
            meta: {},
            members: memberRecords.map((record) => ({
                id: record.pid,
                name: record.name,
                nick: record.nick,
                avatar: record.avatar,
                title: record.title,
                roles: record.roles,
                joinedAt: record.joinedAt?.getTime(),
            })),
            history: history,
        };
    }

    async createAgentTurn(segment: DialogueSegment): Promise<AgentTurn> {
        const turnRecord = await this.ctx.database.create(TableName.AgentTurns, {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            sid: segment.id,
            channelId: segment.channelId,
            platform: segment.platform,
            status: "in_progress",
            timestamp: new Date(),
        });

        return this.constructFullAgentTurnById(segment.platform, segment.channelId, turnRecord.id);
    }

    public async getOrCreateOpenSegment(platform: string, channelId: string): Promise<DialogueSegmentData> {
        const openSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId, status: "open" })
            .orderBy("timestamp", "desc")
            .limit(1)
            .execute();

        if (openSegments.length > 0) {
            return openSegments[0];
        }

        const newSegment: DialogueSegmentData = {
            id: `seg_${Date.now()}_${Random.id(8)}`,
            channelId,
            platform,
            status: "open",
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    /**
     * 根据对话片段ID构造完整的 DialogueSegment 对象。
     * @param segmentId
     */
    async constructFullSegmentById(platform: string, channelId: string, segmentId: string): Promise<DialogueSegment> {
        const [segmentRecord] = await this.ctx.database.get(TableName.DialogueSegments, { id: segmentId });
        if (!segmentRecord) throw new Error(`Segment not found: ${segmentId}`);

        // 获取此片段的消息记录
        const messageRecords = await this.ctx.database.get(TableName.Messages, { sid: segmentRecord.id });

        // 获取此片段的系统事件记录
        const systemEventRecords = await this.ctx.database.get(TableName.SystemEvents, { sid: segmentRecord.id });

        // 构造 DialogueSegment 对象
        const dialogueSegment: DialogueSegment = {
            id: segmentRecord.id,
            platform: platform,
            channelId: channelId,
            status: segmentRecord.status,
            dialogue: messageRecords,
            systemEvents: systemEventRecords.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                payload: record.payload,

                /**
                 * 可选的类型守卫属性，例如 `is_member_join_event: true`，
                 * 便于在代码中进行类型收窄。
                 */
                [`is_${record.type}`]: true,
            })),
            timestamp: segmentRecord.timestamp,
            is_dialogue_segment: true,
        };

        return dialogueSegment;
    }

    async constructFullAgentTurnById(platform: string, channelId: string, id: string): Promise<AgentTurn> {
        const [turnRecord] = await this.ctx.database.get(TableName.AgentTurns, { id });
        if (!turnRecord) throw new Error(`AgentTurn not found: ${id}`);

        // 获取此回合的响应记录
        const responseRecords = await this.ctx.database.get(TableName.AgentResponses, { turnId: turnRecord.id });

        // 构造 AgentTurn 对象
        const agentTurn: AgentTurn = {
            id: turnRecord.id,
            platform: platform,
            channelId: channelId,
            stimulusSegmentId: turnRecord.sid,
            status: turnRecord.status,
            responses: responseRecords,
            timestamp: turnRecord.timestamp,
            is_agent_turn: true,
        };

        return agentTurn;
    }
}
