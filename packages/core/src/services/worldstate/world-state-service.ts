import { Context, Element, h, Random, Service, Session } from "koishi";
import { ChannelDescriptor } from "../../agent";
import { ChatModel, ModelGroup } from "../model";
import { Services, TableName } from "../types";
import { AgentResponse } from "./agent-response-types";
import { HistoryConfig } from "./config";
import { DialogueSegmentData } from "./database-models";
import { AgentTurn, Channel, DialogueSegment, GuildMember, Sender, WorldState } from "./interfaces";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }

    interface Events {
        /** 当对话片段有更新时触发 */
        "worldstate:segment-updated"(session: Session, segmentRecord: DialogueSegmentData): void;
    }
}

/**
 * WorldState 服务
 * 负责收集、管理和提供 Agent 所需的上下文信息。
 */
export class WorldStateService extends Service<HistoryConfig> {
    static readonly inject = [Services.Model, Services.Image];
    private disposer: (() => boolean)[] = [];
    private maintenanceInterval: NodeJS.Timeout;
    private chatModel: ChatModel;

    constructor(ctx: Context, config: HistoryConfig) {
        super(ctx, Services.WorldState, true);
        this.ctx = ctx;
        this.config = config;
        this.chatModel = ctx[Services.Model].useGroup(ModelGroup.Summarization)?.getCurrent();
    }

    protected start(): void {
        this.registerDatabaseModels();
        this.ctx.logger.info("WorldState Service started, listening to events...");
        this.disposer.push(this.ctx.on("message", (session) => this.onMessage(session), true));
        this.maintenanceInterval = setInterval(() => this.handleMaintenance(), this.config.advanced.cleanupIntervalMs);
    }

    protected stop(): void {
        this.disposer.forEach((dispose) => dispose());
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }
        this.ctx.logger.info("WorldState Service stopped.");
    }

    private registerDatabaseModels() {
        this.ctx.model.extend(
            TableName.Members,
            {
                pid: "string(255)",
                platform: "string(255)",
                guildId: "string(255)",
                name: "string(255)",
                roles: "json",
                avatar: "string(255)",
                joinedAt: "timestamp",
                lastActive: "timestamp",
            },
            {
                autoInc: false,
                primary: ["pid", "platform", "guildId"],
                foreign: {
                    pid: ["binding", "pid"],
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
                agentTurn: "json",
                timestamp: "timestamp",
            },
            { primary: "id" }
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
    }

    // --- 公共 API ---

    /**
     * [REFACTOR] 获取指定频道集合的完整世界状态。
     * 这个方法现在非常简洁，因为它依赖 buildFullDialogueSegment 来处理上下文策略。
     * @param allowedChannels 允许 Agent 访问的频道列表
     * @returns WorldState 对象
     */
    public async getWorldState(allowedChannels: ChannelDescriptor[], onetimeCode: string): Promise<WorldState> {
        const activeChannels = await Promise.all(
            allowedChannels.map(({ platform, id }) => this.buildFullContextForChannel(platform, id, onetimeCode))
        );

        // [FIX] 那个低效的后处理循环被彻底移除了！

        return {
            timestamp: new Date().toISOString(),
            activeChannels: activeChannels,
            inactiveChannels: [],
        };
    }

    /**
     * [NEW] 新增一个公共方法，用于将一条消息记录到指定的对话片段中。
     * 这个方法可以被内部（onMessage）和外部（AgentCore）调用。
     * @param segmentId 目标对话片段的 ID
     * @param message 消息对象
     */
    public async recordMessage(
        segmentId: string,
        message: { id: string; platform: string; channelId: string; sender: Sender; content: string; timestamp: Date; quoteId?: string }
    ): Promise<void> {
        await this.ctx.database.create(TableName.Messages, {
            id: message.id,
            sid: segmentId,
            platform: message.platform,
            channelId: message.channelId,
            sender: message.sender,
            content: message.content,
            timestamp: message.timestamp,
            quoteId: message.quoteId,
        });
        this.ctx.logger.debug(`Recorded message ${message.id} into segment ${segmentId}`);
    }

    private async buildFullContextForChannel(Platform: string, Id: string, onetimeCode: string): Promise<Channel> {
        // [REFACTOR] 增强此方法以注入机器人自身的信息
        const bot = this.ctx.bots.find((b) => b.platform === Platform && b.isActive);
        if (!bot) {
            this.ctx.logger.warn(`Could not find an online bot for platform "${Platform}" to build channel context.`);
            // 即使找不到机器人，也应继续尝试构建上下文，只是没有机器人自身的信息
        }

        const channelInfo = await this.ctx.bots.find((b) => b.platform === Platform)?.getChannel(Id);
        if (!channelInfo) {
            // 如果无法获取频道信息，可以返回一个基础的 Channel 对象或抛出错误
            this.ctx.logger.warn(`Failed to get channel info for ${Platform}:${Id}`);
            return { id: Id, platform: Platform, name: `Channel ${Id}`, type: "guild", meta: {}, members: [], history: [] };
        }

        const segmentRecords = await this.ctx.database
            .get(TableName.DialogueSegments, {
                platform: Platform,
                channelId: Id,
                status: { $ne: "archived" },
            })
            .then((res) => res.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));

        const history: DialogueSegment[] = await Promise.all(
            segmentRecords.map((record) => this.buildFullDialogueSegment(record, onetimeCode))
        );

        const memberIds = new Set<string>();
        history.forEach((segment) => {
            segment.dialogue.forEach((message) => {
                // 确保我们只添加非 AI 的成员 ID
                if (message.sender.pid !== "agent") {
                    memberIds.add(message.sender.pid);
                }
            });
        });

        // 从数据库获取所有人类成员
        const humanMembers =
            memberIds.size > 0
                ? await this.ctx.database.get(TableName.Members, { platform: Platform, guildId: Id, pid: { $in: Array.from(memberIds) } })
                : [];

        // [NEW] 创建并注入机器人自身作为成员
        let allMembers: GuildMember[] = humanMembers;
        if (bot) {
            const botAsMember: GuildMember = {
                pid: bot.selfId,
                name: bot.user.name,
                nick: bot.user.nick || bot.user.name,
                roles: ["assistant", "bot"],
                isSelf: true, // 关键标记
            };
            // 将机器人添加到列表开头，并确保没有重复
            allMembers = [botAsMember, ...humanMembers.filter((m) => m.pid !== bot.selfId)];
        }

        const channel: Channel = {
            id: Id,
            name: channelInfo.name,
            type: "guild",
            platform: Platform,
            meta: {},
            members: allMembers, // 使用包含机器人的新成员列表
            history: history,
        };
        return channel;
    }

    /**
     * [REFACTOR] 根据数据库记录和其状态，高效地构建完整的 DialogueSegment 对象。
     * 这是实现上下文策略的核心。
     * @param segmentRecord
     * @returns
     */
    public async buildFullDialogueSegment(segmentRecord: DialogueSegmentData, onetimeCode: string): Promise<DialogueSegment> {
        const dialogueSegment: DialogueSegment = {
            type: "dialogue-segment",
            id: segmentRecord.id,
            platform: segmentRecord.platform,
            channelId: segmentRecord.channelId,
            guildId: segmentRecord.guildId,
            status: segmentRecord.status,
            summary: segmentRecord.summary,
            timestamp: segmentRecord.timestamp,
            agentTurn: segmentRecord.agentTurn,
            // 先用空值初始化
            dialogue: [],
            systemEvents: [],
        };

        // [FIX] 核心优化：根据状态决定是否查询数据库
        if (segmentRecord.status === "summarized") {
            // 对于已总结的片段，不加载任何对话细节，大大提升性能
            dialogueSegment.agentTurn = null; // 总结片段不应有关联的 Agent 回合
        } else {
            // 对于 open, closed, folded 状态，加载对话细节
            const messageRecords = await this.ctx.database.get(TableName.Messages, { sid: segmentRecord.id });
            const systemEventRecords = await this.ctx.database.get(TableName.SystemEvents, { sid: segmentRecord.id });

            function transform(source: string) {
                const warp = (element: Element, onecode: string) => {
                    element.attrs.onetime_code = onecode;
                    return element;
                };
                return h.transform(source, (element) => {
                    switch (element.type) {
                        case "text":
                            return h.text(element.attrs.content);
                        default:
                            return warp(element, onetimeCode);
                    }
                });
            }

            dialogueSegment.dialogue = messageRecords.map((record) => ({
                id: record.id,
                content: transform(record.content),
                timestamp: record.timestamp,
                date: formatDate(record.timestamp),
                quoteId: record.quoteId,
                sender: record.sender,
            }));
            dialogueSegment.systemEvents = systemEventRecords.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                date: formatDate(record.timestamp),
                payload: record.payload,
            }));

            // 对于 folded 状态，隐藏 agentTurn 的细节
            if (segmentRecord.status === "folded" && dialogueSegment.agentTurn) {
                dialogueSegment.agentTurn.responses = [];
            }
        }

        return dialogueSegment;
    }

    public async recordAgentTurn(segmentRecord: DialogueSegmentData, responses: AgentResponse[]): Promise<void> {
        const agentTurn: AgentTurn = {
            responses,
            timestamp: new Date(),
        };

        await this.ctx.database.set(TableName.DialogueSegments, { id: segmentRecord.id }, { status: "closed", agentTurn: agentTurn });
        this.ctx.logger.debug(`Segment ${segmentRecord.id} closed and agent turn recorded.`);

        const closedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            channelId: segmentRecord.channelId,
            platform: segmentRecord.platform,
            status: "closed",
        });

        if (closedSegments.length > this.config.fullContextSegmentCount) {
            const segmentsToFold = closedSegments
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .slice(0, closedSegments.length - this.config.fullContextSegmentCount);

            const idsToFold = segmentsToFold.map((s) => s.id);
            if (idsToFold.length > 0) {
                await this.ctx.database.set(TableName.DialogueSegments, { id: { $in: idsToFold } }, { status: "folded" });
                this.ctx.logger.info(`Folded ${idsToFold.length} segments in channel ${segmentRecord.channelId}.`);
            }
        }

        // const updatedSegmentRecord = await this.ctx.database.get(TableName.DialogueSegments, { id: segment.id }).then((res) => res[0]);
    }

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
            agentTurn: null,
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    private async onMessage(session: Session): Promise<void> {
        // 检查是否在允许的频道中
        let allowed = false;
        if (this.config.allowedChannels.has(session.cid)) {
            allowed = true;
        } else if (this.config.allowedChannels.has("*:*")) {
            allowed = true;
        } else if (this.config.allowedChannels.has(`${session.platform}:*`)) {
            allowed = true;
        } else if (this.config.allowedChannels.has(`${session.platform}:all`)) {
            allowed = true;
        }

        if (!allowed) {
            if (this.config.system.debug.enable) {
                this.ctx.logger.info(`Message from ${session.author.name} in ${session.cid} ignored.`);
            }
            return;
        }

        if (session.guildId) {
            await this.ctx.database.upsert(TableName.Members, [
                {
                    pid: session.userId,
                    platform: session.platform,
                    guildId: session.guildId,
                    name: session.author.nick || session.author.name,
                    roles: session.author.roles,
                    avatar: session.author.avatar,
                    lastActive: new Date(),
                },
            ]);
        }

        /**  */
        const transformedContent = await h
            .transformAsync(session.elements, async (element) => {
                switch (element.type) {
                    case "text":
                        return h.escape(element.attrs.content);
                    case "img":
                    case "image":
                        return await this.ctx[Services.Image].processImageElement(element, session);
                    default:
                        return element;
                }
            })
            .then((res) => res.join(" ").trim());

        // 如果转换后内容为空 (例如，只发送了一张加载失败的图片)，则不处理
        if (!transformedContent) {
            this.ctx.logger.debug(`Message ${session.messageId} resulted in empty content after transformation. Ignoring.`);
            return;
        }

        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        // 使用新的 recordMessage 方法，并传入转换后的内容
        await this.recordMessage(segmentRecord.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                pid: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            timestamp: new Date(session.timestamp),
            content: transformedContent,
            quoteId: session.quote?.id,
        });

        this.ctx.emit("worldstate:segment-updated", session, segmentRecord);
    }

    private async handleMaintenance() {
        if (!this.config.enableSummarization) return;
        this.ctx.logger.debug("Running worldstate maintenance task...");

        try {
            const channelsToSummarize = await this.findChannelsWithSufficientFoldedSegments();

            for (const channel of channelsToSummarize) {
                await this.summarizeAndArchive(channel.platform, channel.channelId);
            }
        } catch (error) {
            this.ctx.logger.error("Error during worldstate maintenance task:", error);
        }
    }

    private async findChannelsWithSufficientFoldedSegments(): Promise<{ platform: string; channelId: string }[]> {
        const allFoldedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            status: "folded",
        });

        const channelCounts: Record<string, number> = {};
        const channelMetas: Record<string, { platform: string; channelId: string }> = {};

        for (const segment of allFoldedSegments) {
            const key = `${segment.platform}:${segment.channelId}`;
            if (!channelCounts[key]) {
                channelCounts[key] = 0;
                channelMetas[key] = { platform: segment.platform, channelId: segment.channelId };
            }
            channelCounts[key]++;
        }

        const channelsToProcess: { platform: string; channelId: string }[] = [];
        for (const key in channelCounts) {
            if (channelCounts[key] >= this.config.summarizationTriggerCount) {
                channelsToProcess.push(channelMetas[key]);
            }
        }

        return channelsToProcess;
    }

    private async summarizeAndArchive(platform: string, channelId: string) {
        const foldedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            platform,
            channelId,
            status: "folded",
        });

        if (foldedSegments.length < this.config.summarizationTriggerCount) return;

        foldedSegments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const groupIds = foldedSegments.map((s) => s.id);
        const latestTimestamp = foldedSegments[foldedSegments.length - 1].timestamp;

        const dialogueText = await this.renderGroupToText(foldedSegments);
        const prompt = this.config.summarizationPrompt.replace("{dialogueText}", dialogueText);

        const summaryText = await this.chatModel.chat([{ role: "user", content: prompt }]).then((res) => res.text);
        if (!summaryText) {
            this.ctx.logger.warn(`Summarization failed for channel ${channelId}, no response from model.`);
            return;
        }

        const summarySegment: DialogueSegmentData = {
            id: `sum_${Date.now()}_${Random.id(8)}`,
            platform: platform,
            channelId: channelId,
            guildId: foldedSegments[0].guildId,
            status: "summarized",
            summary: summaryText,
            timestamp: latestTimestamp,
            agentTurn: null,
        };

        await this.ctx.database.withTransaction(async (db) => {
            await db.create(TableName.DialogueSegments, summarySegment);
            await db.set(TableName.DialogueSegments, { id: { $in: groupIds } }, { status: "archived" });
        });

        this.ctx.logger.info(`Successfully summarized ${groupIds.length} segments into one for channel ${channelId}.`);
    }

    /**
     * [REFACTOR] 彻底重构此方法，使其依赖单一事实来源（messages 表），
     * 不再手动解析 AgentTurn，从而确保 AI 自己的消息被正确包含。
     * @param group 一组需要被渲染为文本的对话片段数据。
     * @returns 格式化后的完整对话历史字符串。
     */
    private async renderGroupToText(group: DialogueSegmentData[]): Promise<string> {
        if (!group || group.length === 0) {
            return "";
        }

        // 1. 收集所有需要查询的 segment ID
        const segmentIds = group.map((segment) => segment.id);

        // 2. 一次性从数据库中获取所有相关的消息（包括用户和 AI 的）
        const allMessages = await this.ctx.database.get(TableName.Messages, {
            sid: { $in: segmentIds },
        });

        // 3. 按时间戳对所有消息进行排序，以构建正确的对话流
        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // 4. 将排序后的消息格式化为最终的文本字符串
        const dialogueLines = allMessages.map((msg) => {
            // 使用 sender.name，它对于 AI 和用户都已正确设置
            const senderName = msg.sender.name || "Unknown";
            const timestampStr = new Date(msg.timestamp).toLocaleString();
            return `[${timestampStr}] ${senderName}: ${msg.content}`;
        });

        return dialogueLines.join("\n");
    }
}

function formatDate(date: Date, format: string = "YYYY-MM-DD HH:mm:ss") {
    const pad = (num) => String(num).padStart(2, "0");
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    return format
        .replace(/YYYY/g, year.toString())
        .replace(/YY/g, String(year).slice(-2))
        .replace(/MM/g, pad(month))
        .replace(/M/g, month.toString())
        .replace(/DD/g, pad(day))
        .replace(/D/g, day.toString())
        .replace(/HH/g, pad(hours))
        .replace(/H/g, hours.toString())
        .replace(/mm/g, pad(minutes))
        .replace(/m/g, minutes.toString())
        .replace(/ss/g, pad(seconds))
        .replace(/s/g, seconds.toString());
}
