import { Context, Logger, Random, Service, Session } from "koishi";

import { IEmbedModel, TaskType } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { HistoryCommandManager } from "./commands";
import { HistoryConfig } from "./config";
import { ContextBuilder } from "./context-builder";
import { DialogueSegmentData, MessageData } from "./database-models";
import { EventListenerManager } from "./event-listener";
import { DialogueSegmentManager } from "./segment-manager";
import { SummarizationManager } from "./summarize";
import { AgentResponse, AgentStimulus, ContextualMessage, SystemEventPayload, UserMessagePayload, WorldState } from "./types";
import { pruneHistoryByMessages } from "./utils";

// 扩展 Koishi 的 Context 和 Events 接口
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "worldstate:summary"(summaryChunk: {
            self: { id: string; name: string };
            platform: string;
            contextId: string;
            dialogue: ContextualMessage[];
        }): void;
    }
}

// =================================================================================
// #region WorldStateService - 核心协调器
// =================================================================================
export class WorldStateService extends Service<HistoryConfig> {
    static readonly inject = [Services.Model, Services.Asset, Services.Logger, Services.Prompt, Services.Memory, "database"];

    public summarizationManager: SummarizationManager;
    public contextBuilder: ContextBuilder;
    public segmentManager: DialogueSegmentManager;

    private _logger: Logger;
    private embedModel: IEmbedModel;
    private maintenanceTimer: NodeJS.Timeout;
    private eventListenerManager: EventListenerManager;
    private commandManager: HistoryCommandManager;
    private readonly mutedChannels = new Map<string, number>(); // Key: channelCid, Value: mute expiration timestamp

    constructor(ctx: Context, config: HistoryConfig) {
        super(ctx, Services.WorldState, true);
        this.ctx = ctx;
        this.config = config;

        // 初始化所有管理器
        this.segmentManager = new DialogueSegmentManager(ctx, config);
        this.summarizationManager = new SummarizationManager(ctx, config);
        this.contextBuilder = new ContextBuilder(ctx, config);
        this.eventListenerManager = new EventListenerManager(ctx, this, config);
        this.commandManager = new HistoryCommandManager(ctx, this, config);
    }

    protected start(): void {
        this._logger = this.ctx[Services.Logger].getLogger("[世界状态]");
        try {
            this.embedModel = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding).getModels()[0];
        } catch {
            this.embedModel = null;
        }
        if (!this.embedModel) this._logger.warn("未找到任何可用的嵌入模型");

        this.registerModels();
        this.eventListenerManager.start();
        this.commandManager.register();

        // 维护任务现在更清晰
        this.maintenanceTimer = setInterval(() => {
            this.runMaintenanceTasks();
        }, this.config.cleanupIntervalSec * 1000);

        //this._logger.info("服务已启动");
    }

    protected stop(): void {
        this.eventListenerManager.stop();
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
        }
        this._logger.info("服务已停止");
    }

    // =================================================================================
    // #region 公共 API
    // =================================================================================

    /* prettier-ignore */
    public async buildContextForStimulus(stimulus: AgentStimulus<any>): Promise<{ worldState: WorldState; triggerContext: object }> {
        const { type, session, payload } = stimulus;

        const worldState = await this.getBaseWorldState(session);

        let triggerContext: object = {};
        switch (type) {
            case "user_message":
                triggerContext = { isUserMessage: true, sid: (payload as UserMessagePayload).sid };
                break;
            case "system_event":
                triggerContext = {
                    isSystemEvent: true,
                    event: payload,
                };
                break;
            // Future cases
            case "scheduled_task":
            case "background_task_completion":
                // Placeholder for future implementation
                break;
        }

        return { worldState, triggerContext };
    }

    private async getBaseWorldState(session: Session): Promise<WorldState> {
        const { platform, channelId } = session;
        const bot = this.ctx.bots.find((b) => b.platform === platform && b.isActive);

        if (!bot) {
            this._logger.warn(`找不到平台 ${platform} 的在线机器人 | 频道: ${channelId}`);
            const channel = {
                id: channelId,
                platform,
                name: `Offline Channel ${channelId}`,
                type: "unknown",
                meta: {},
                members: [],
                history: { pending: undefined },
            };
            return { users: [], channel };
        }

        const worldState = session.isDirect
            ? await this.contextBuilder.buildPrivateChannelContext(bot, { platform, id: channelId })
            : await this.contextBuilder.buildGuildChannelContext(bot, { platform, id: channelId });

        return pruneHistoryByMessages(worldState, this.config.maxMessages);
    }

    public async recordAgentTurn(sid: string, responses: AgentResponse[]): Promise<void> {
        // 委托给 segmentManager
        await this.segmentManager.closeSegmentByAgent(sid, responses);

        const segmentRecord = await this.ctx.database.get(TableName.DialogueSegments, { id: sid }).then((res) => res[0]);
        if (segmentRecord) {
            await this.applyFoldingPolicy(segmentRecord.platform, segmentRecord.channelId);
        }
    }

    public async getOpenSegment(platform: string, channelId: string, guildId?: string): Promise<DialogueSegmentData> {
        // 委托给 segmentManager
        const segment = await this.segmentManager.getOrCreateOpenSegment(platform, channelId, guildId);
        // 如果在 getOrCreateOpenSegment 中关闭了冗余片段，也应触发折叠策略
        // 为确保一致性，可以在这里检查并触发
        if (segment.status === "open") {
            // 确保是新创建或已存在的开放片段
            const closedCount = await this.ctx.database.get(
                TableName.DialogueSegments,
                { platform, channelId, status: "closed" },
                { fields: ["id"] }
            );
            if (closedCount.length > this.config.fullContextSegmentCount) {
                await this.applyFoldingPolicy(platform, channelId);
            }
        }
        return segment;
    }

    public async recordMessage(segmentId: string, message: Omit<MessageData, "sid">): Promise<void> {
        // 委托给 segmentManager
        await this.segmentManager.recordMessage(segmentId, message);
    }

    /**
     * 引导模型关注被跳过的话题
     * @param channelKey 频道标识符 (platform:channelId)
     */
    public async guideToSkippedTopic(channelKey: string): Promise<void> {
        const [platform, channelId] = channelKey.split(":", 2);
        if (!platform || !channelId) return;

        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) return;

        const session = {
            platform,
            channelId,
            isDirect: channelId.startsWith("private:"),
            bot,
            // 其他必要属性
        } as any as Session;

        if (!session) return;

        const worldState = await this.getBaseWorldState(session);

        // 添加提示引导模型关注被跳过的话题
        if (worldState.channel.history.pending) {
            worldState.channel.history.pending.dialogue.push({
                id: "system-guidance",
                content: "<系统提示>请注意，之前有未处理完的话题需要关注",
                timestamp: new Date(),
                sender: {
                    id: "system",
                    name: "系统",
                    roles: ["system"],
                },
            });
        }
    }

    public async recordSystemEvent(session: Session, payload: SystemEventPayload): Promise<void> {
        const segment = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
        await this.ctx.database.create(TableName.SystemEvents, {
            id: `sysevt_${Random.id()}`,
            sid: segment.id,
            type: payload.eventType,
            timestamp: new Date(),
            payload,
        });
    }

    // #endregion

    // =================================================================================
    // #region 内部辅助方法
    // =================================================================================

    public isBotMuted(channelCid: string): boolean {
        const expiresAt = this.mutedChannels.get(channelCid);
        if (!expiresAt) return false;

        if (Date.now() > expiresAt) {
            this.mutedChannels.delete(channelCid);
            return false;
        }

        return true;
    }

    public updateMuteStatus(cid: string, expiresAt: number): void {
        if (expiresAt > Date.now()) {
            this.mutedChannels.set(cid, expiresAt);
            this.logger.debug(`[${cid}] | 已被禁言 | 解封时间: ${new Date(expiresAt).toLocaleString()}`);
        } else {
            this.mutedChannels.delete(cid);
            this.logger.debug(`[${cid}] | 禁言状态已解除`);
        }
    }

    public isChannelAllowed(session: Session): boolean {
        const cid = session.cid;
        const platform = session.platform;
        const allowed = Array.from(this.config.allowedChannels);
        return allowed.some(
            (c) =>
                c === cid ||
                c === "*:*" ||
                c === `${platform}:*` ||
                c === `${platform}:all` ||
                c === `${platform}:private:*` ||
                c === `${platform}:private:all` ||
                c === `${platform}:guild:*` ||
                c === `${platform}:guild:all`
        );
    }

    // #endregion

    // =================================================================================
    // #region 维护与策略
    // =================================================================================

    private registerModels(): void {
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
            { autoInc: false, primary: ["pid", "platform", "guildId"] }
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
                startTimestamp: "timestamp",
                endTimestamp: "timestamp",
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
                sender: "object",
                timestamp: "timestamp",
                content: "text",
                quoteId: "string(255)",
            },
            {
                foreign: { sid: [TableName.DialogueSegments, "id"] },
                indexes: [["platform", "channelId"]],
            }
        );
        this.ctx.model.extend(
            TableName.SystemEvents,
            {
                id: "string(64)",
                sid: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                type: "string(64)",
                timestamp: "timestamp",
                payload: "json",
            },
            {
                primary: "id",
                foreign: { sid: [TableName.DialogueSegments, "id"] },
                indexes: [["platform", "channelId"], ["sid"]],
            }
        );
    }

    private async applyFoldingPolicy(platform: string, channelId: string): Promise<void> {
        const closedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            platform,
            channelId,
            status: "closed",
        });
        if (closedSegments.length > this.config.fullContextSegmentCount) {
            const segmentsToFold = closedSegments
                .sort((a, b) => a.startTimestamp.getTime() - b.startTimestamp.getTime())
                .slice(0, closedSegments.length - this.config.fullContextSegmentCount);
            const idsToFold = segmentsToFold.map((s) => s.id);
            if (idsToFold.length > 0) {
                await this.ctx.database.set(TableName.DialogueSegments, { id: { $in: idsToFold } }, { status: "folded" });
                this._logger.debug(`折叠了 ${idsToFold.length} 个旧片段 | 频道: ${platform}:${channelId}`);
            }
        }
    }

    private runMaintenanceTasks(): void {
        this.eventListenerManager.cleanupPendingCommands();
        this.cleanupExpiredMutes();

        // **核心优化：执行片段状态检查**
        this.segmentManager
            .checkAndCloseOpenSegments()
            .then(() => {
                // 检查关闭后，可能需要对涉及的频道应用折叠策略
                // (为简化，此步可省略，或在 checkAndCloseOpenSegments 内部实现更复杂的逻辑)
            })
            .catch((error) => this._logger.error("对话片段状态检查任务执行失败", error.message));

        this._cleanupExpiredRecords().catch((error) => this._logger.error("清理过期记录任务执行失败", error.message));

        if (this.config.summarization.enabled) {
            this.summarizationManager
                .targetSummarizationTasks()
                .catch((error) => this._logger.error("自动总结任务执行失败", error.message));
        }
    }

    private async _cleanupExpiredRecords(): Promise<void> {
        const expirationTime = this.config.dataRetentionDays * 24 * 60 * 60 * 1000;
        const expirationCutoff = new Date(Date.now() - expirationTime);

        const expiredSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            startTimestamp: { $lt: expirationCutoff },
        });
        if (expiredSegments.length > 0) {
            const segmentIds = expiredSegments.map((s) => s.id);
            await this.ctx.database.withTransaction(async (db) => {
                await db.remove(TableName.Messages, { sid: { $in: segmentIds } });
                await db.remove(TableName.SystemEvents, { sid: { $in: segmentIds } });
                await db.remove(TableName.DialogueSegments, { id: { $in: segmentIds } });
            });
            this._logger.info(`清理了 ${expiredSegments.length} 个过期的对话片段及其相关记录`);
        }
    }

    private cleanupExpiredMutes(): void {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [channelCid, expiresAt] of this.mutedChannels.entries()) {
            if (now > expiresAt) {
                this.mutedChannels.delete(channelCid);
                cleanedCount++;
                this.logger.info(`频道 ${channelCid} 的机器人禁言状态已到期并移除。`);
            }
        }
        if (cleanedCount > 0) {
            this.logger.debug(`清理了 ${cleanedCount} 个过期的禁言状态。`);
        }
    }
    // #endregion
}
// #endregion
