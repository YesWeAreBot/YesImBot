import { Context, Random, Service, Session } from "koishi";
import { Services } from "../types";
import { WorldStateConfig } from "./config";
import { AgentTurnData, DialogueSegmentData, TableName } from "./database-models";
import { AgentTurn, Channel, DialogueSegment, WorldState } from "./interfaces";

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
 * 负责收集、管理和提供 Agent 所需的上下文信息。
 */
export class WorldStateService extends Service {
    static readonly inject = [Services.Model];
    private disposer: (() => boolean)[] = [];

    constructor(ctx: Context, config: WorldStateConfig) {
        super(ctx, Services.WorldState, true);
        this.config = config;
    }

    /**
     * Koishi 服务生命周期方法，在插件启动时调用。
     * 在这里注册事件监听器和后台定时任务。
     */
    protected start(): void {
        this.registerDatabaseModels();
        this.ctx.logger.info("WorldState Service started, listening to events...");

        // 监听所有消息事件
        this.disposer.push(this.ctx.on("message", (session) => this.onMessage(session), true));
    }

    protected stop(): void {
        this.disposer.forEach((dispose) => dispose());
        this.ctx.logger.info("WorldState Service stopped.");
    }

    /**
     * 初始化方法，注册数据库模型。
     */
    private registerDatabaseModels() {
        this.ctx.model.extend(
            TableName.Members,
            {
                uid: "unsigned",
                pid: "string(255)",
                platform: "string(255)",
                guildId: "string(255)",
                name: "string(255)",
                username: "string(255)",
                roles: "json",
                avatar: "string(255)",
                joinedAt: "timestamp",
                lastActive: "timestamp",
            },
            {
                autoInc: false,
                primary: ["uid", "platform", "guildId"],
                foreign: {
                    uid: ["user", "id"],
                },
            }
        );

        this.ctx.model.extend(
            TableName.DialogueSegments,
            {
                id: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                guildId: "string(255)",
                status: "string(32)",
                summary: "text",
                timestamp: "timestamp",
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.AgentTurns,
            {
                id: "string(64)",
                sid: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                status: "string(32)",
                timestamp: "timestamp",
            },
            {
                primary: "id",
                foreign: { sid: [TableName.DialogueSegments, "id"] },
            }
        );

        this.ctx.model.extend(
            TableName.Messages,
            {
                id: "string(255)",
                platform: "string(255)",
                sid: "string(64)",
                channelId: "string(255)",
                sender: "json",
                timestamp: "timestamp",
                content: "text",
                quoteId: "string(255)",
            },
            {
                primary: ["id", "platform"],
                foreign: { sid: [TableName.DialogueSegments, "id"] },
            }
        );

        this.ctx.model.extend(
            TableName.SystemEvents,
            {
                id: "string(64)",
                sid: "string(64)",
                type: "string(64)",
                timestamp: "timestamp",
                payload: "json",
            },
            {
                primary: "id",
                foreign: { sid: [TableName.DialogueSegments, "id"] },
            }
        );

        this.ctx.model.extend(
            TableName.AgentResponses,
            {
                id: "unsigned",
                turnId: "string(64)",
                thoughts: "json",
                actions: "json",
                observations: "json",
                request_heartbeat: "boolean",
            },
            {
                autoInc: true,
                primary: "id",
                foreign: { turnId: [TableName.AgentTurns, "id"] },
            }
        );
    }

    // --- 公共 API ---

    /**
     * 获取指定频道集合的完整世界状态。
     * @param allowedChannels 允许 Agent 访问的频道列表
     * @returns WorldState 对象
     */
    public async getWorldState(allowedChannels: { Platform: string; Id: string }[]): Promise<WorldState> {
        const activeChannels = await Promise.all(allowedChannels.map(({ Platform, Id }) => this.buildFullContextForChannel(Platform, Id)));

        return {
            timestamp: new Date().toISOString(),
            activeChannels: activeChannels,
            inactiveChannels: [],
        };
    }

    private async buildFullContextForChannel(Platform: string, Id: string): Promise<Channel> {
        const bot = this.ctx.bots.find((bot) => bot.platform === Platform);

        // 群聊
        const channelInfo = await bot.getChannel(Id);
        //const channelRecord = await this.ctx.database.get("channel", { id: Id, platform: Platform }).then((res) => res[0]);
        //const members = await this.ctx.database.get(TableName.Members, { platform: Platform, guildId: Id });

        // 获取所有未被物理删除的对话片段
        const segmentRecord = await this.ctx.database.get(TableName.DialogueSegments, {
            platform: Platform,
            channelId: Id,
            status: { $ne: "archived" },
        });

        const dialogueSegments: DialogueSegment[] = await Promise.all(segmentRecord.map((record) => this.buildFullDialogueSegment(record)));

        // 获取所有与这些片段关联的 Agent 回合
        const agentTurnRecords = await this.ctx.database.get(TableName.AgentTurns, { sid: segmentRecord.map((record) => record.id) });

        const agentTurns: AgentTurn[] = await Promise.all(agentTurnRecords.map((record) => this.buildFullAgentTurn(record)));

        const history = [...dialogueSegments, ...agentTurns].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        const memberIds = [];

        // 获取所有参与过对话的成员
        dialogueSegments.forEach((segment) => {
            segment.dialogue.forEach((message) => {
                memberIds.push(message.sender.pid);
            });
        });

        const members = await this.ctx.database.get(TableName.Members, { platform: Platform, guildId: Id, pid: { $in: memberIds } });

        const channel: Channel = {
            id: Id,
            name: channelInfo.name,
            type: "guild",
            platform: Platform,
            meta: {},
            members: members,
            history: history,
        };
        return channel;
    }

    /**
     * 根据数据库记录构建完整的 DialogueSegment 对象。
     * @param segmentRecord
     * @returns
     */
    private async buildFullDialogueSegment(segmentRecord: DialogueSegmentData): Promise<DialogueSegment> {
        const messageRecords = await this.ctx.database.get(TableName.Messages, { sid: segmentRecord.id });
        const systemEventRecords = await this.ctx.database.get(TableName.SystemEvents, { sid: segmentRecord.id });

        const dialogueSegment: DialogueSegment = {
            type: "dialogue-segment",
            //@ts-ignore
            is_dialogue_segment: true,
            id: segmentRecord.id,
            platform: segmentRecord.platform,
            channelId: segmentRecord.channelId,
            guildId: segmentRecord.guildId,
            status: segmentRecord.status,
            dialogue: messageRecords.map((record) => ({
                id: record.id,
                content: record.content,
                timestamp: record.timestamp,
                quoteId: record.quoteId,
                sender: record.sender,
            })),
            systemEvents: systemEventRecords.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                payload: record.payload,
            })),
            summary: segmentRecord.summary,
            timestamp: segmentRecord.timestamp,
        };

        return dialogueSegment;
    }
    /**
     *
     * @param record
     * @returns
     */
    private async buildFullAgentTurn(record: AgentTurnData): Promise<AgentTurn> {
        // 获取此回合的响应记录
        const responseRecords = await this.ctx.database.get(TableName.AgentResponses, { turnId: record.id });

        const turn: AgentTurn = {
            type: "agent-turn",
            //@ts-ignore
            is_agent_turn: true,
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            stimulusSegmentId: record.sid,
            status: record.status,
            responses: responseRecords,
            timestamp: record.timestamp,
        };
        return turn;
    }

    /**
     * 创建一个新的 Agent 回合。
     * 此操作会关闭当前频道的开放对话片段。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @returns 创建的 AgentTurn 对象
     */
    public async createAgentTurn(segment: DialogueSegment): Promise<AgentTurn> {
        // 关闭当前开放的对话片段
        await this.ctx.database.set(TableName.DialogueSegments, { id: segment.id }, { status: "closed" });

        // 创建新的 Agent 回合记录
        const turnRecord = await this.ctx.database.create(TableName.AgentTurns, {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            sid: segment.id,
            channelId: segment.channelId,
            platform: segment.platform,
            status: "in_progress",
            timestamp: new Date(),
        });

        // 构造并返回完整的 AgentTurn 对象
        return this.buildFullAgentTurn(turnRecord);
    }

    /**
     * 获取或创建当前开放的对话片段。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @param guildId 群组ID
     * @returns
     */
    public async getOpenSegment(platform: string, channelId: string, guildId?: string): Promise<DialogueSegmentData> {
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
            platform,
            channelId,
            guildId,
            status: "open",
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    // --- 事件处理器 ---

    /**
     * 消息处理流程
     */
    private async onMessage(session: Session): Promise<void> {
        // 更新或创建成员信息
        if (session.guildId) {
            const [binding] = await this.ctx.database.get("binding", { platform: session.platform, pid: session.userId });
            if (binding) {
                await this.ctx.database.upsert(TableName.Members, [
                    {
                        uid: binding.aid,
                        pid: session.userId,
                        platform: session.platform,
                        guildId: session.guildId,
                        name: session.author.nick || session.author.name,
                        username: session.author.username,
                        roles: session.author.roles,
                        avatar: session.author.avatar,
                        lastActive: new Date(),
                    },
                ]);
            }
        }

        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        // 消息入库
        await this.ctx.database.create(TableName.Messages, {
            id: session.messageId,
            sid: segmentRecord.id,
            channelId: session.channelId,
            platform: session.platform,
            sender: {
                pid: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            timestamp: new Date(session.timestamp),
            content: session.content,
            quoteId: session.quote?.id,
        });

        // 此处可以触发事件，但注意避免在事件处理中再次进行昂贵的数据库查询
        const dialogueSegment = await this.buildFullDialogueSegment(segmentRecord);
        this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
    }
}
