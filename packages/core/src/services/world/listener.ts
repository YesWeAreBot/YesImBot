import { Random, type Context, type Session } from "koishi";
import type { HistoryConfig } from "./config";
import type { EventRecorder } from "./recorder";
import type { WorldStateService } from "./service";
import type { UserMessageStimulus } from "./types";
import type { AssetService } from "@/services/assets";
import { Services, TableName } from "@/shared/constants";
import { truncate } from "@/shared/utils";
import { StimulusSource } from "./types";

export class EventListener {
    private readonly disposers: (() => boolean)[] = [];

    private assetService: AssetService;
    private recorder: EventRecorder;

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private service: WorldStateService,
    ) {
        this.assetService = ctx[Services.Asset];
        this.recorder = service.recorder;
    }

    public start(): void {
        this.registerEventListeners();
    }

    public stop(): void {
        this.disposers.forEach(dispose => dispose());
        this.disposers.length = 0;
    }

    private registerEventListeners(): void {
        // 这个中间件记录用户消息，并触发响应流程
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                if (!this.service.isChannelAllowed(session))
                    return next();

                if (session.author?.isBot)
                    return next();

                await this.recordUserMessage(session);
                await next();

                const stimulus: UserMessageStimulus = {
                    type: StimulusSource.UserMessage,
                    payload: session,
                    priority: 5,
                    timestamp: new Date(),
                };
                this.ctx.emit("agent/stimulus-user-message", stimulus);
            }),
        );

        // 在发送后记录机器人消息
        this.disposers.push(
            this.ctx.on(
                "after-send",
                (session) => {
                    if (!this.service.isChannelAllowed(session))
                        return;
                    this.recordBotSentMessage(session);
                },
                true,
            ),
        );

        // 记录从另一个设备手动发送的消息
        this.disposers.push(
            this.ctx.on("message", (session) => {
                if (!this.service.isChannelAllowed(session))
                    return;
                if (session.userId === session.bot.selfId && !session.scope) {
                    if (this.config.ignoreSelfMessage)
                        return;
                    this.handleOperatorMessage(session);
                }
            }),
        );

        // 监听系统事件，记录特定事件
        // this.disposers.push(
        //     this.ctx.on("internal/session", (session) => {
        //         if (!this.service.isChannelAllowed(session))
        //             return;
        //         if (session.type === "notice" && session.platform === "onebot")
        //             return this.handleNotice(session);
        //         if (session.type === "guild-member" && session.platform === "onebot")
        //             return this.handleGuildMember(session);
        //         if (session.type === "message-deleted")
        //             return this.handleMessageDeleted(session);
        //     }),
        // );
    }

    private async handleOperatorMessage(session: Session): Promise<void> {
        this.ctx.logger.debug(`记录手动发送的消息 | 频道: ${session.cid}`);
        await this.recordBotSentMessage(session);
    }

    private async recordUserMessage(session: Session): Promise<void> {
        /* prettier-ignore */
        this.ctx.logger.info(`用户消息 | ${session.author.name} | 频道: ${session.cid} | 内容: ${truncate(session.content).replace(/\n/g, " ")}`);

        if (session.guildId) {
            await this.updateMemberInfo(session);
        }

        const content = await this.assetService.transform(session.content);
        this.ctx.logger.debug(`记录转义后的消息：${content}`);

        await this.recorder.recordMessage({
            id: Random.id(),
            scopeId: session.cid,
            timestamp: new Date(session.timestamp),
            eventData: {
                id: session.messageId,
                senderId: session.author.id,
                senderName: session.author.nick || session.author.name,
                content: session.content,
            }
        });
    }

    private async recordBotSentMessage(session: Session): Promise<void> {
        if (!session.content || !session.messageId)
            return;

        this.ctx.logger.debug(`记录机器人消息 | 频道: ${session.cid} | 消息ID: ${session.messageId}`);

        await this.recorder.recordMessage({
            id: Random.id(),
            scopeId: session.cid,
            timestamp: new Date(session.timestamp),
            eventData: {
                id: session.messageId,
                senderId: session.bot.selfId,
                senderName: session.bot.user.nick || session.bot.user.nick,
                content: session.content,
            }
        });
    }

    // TODO: 从平台适配器拉取用户信息
    private async updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author)
            return;

        try {
            const memberKey = { pid: session.userId, platform: session.platform, guildId: session.guildId };
            const memberData = {
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
                avatar: session.author.avatar,
                lastActive: new Date(),
            };

            const existing = await this.ctx.database.get(TableName.Members, memberKey);
            if (existing.length > 0) {
                await this.ctx.database.set(TableName.Members, memberKey, memberData);
            }
            else {
                await this.ctx.database.create(TableName.Members, { ...memberKey, ...memberData });
            }
        }
        catch (error: any) {
            this.ctx.logger.error(`更新成员信息失败: ${error.message}`);
        }
    }
}
