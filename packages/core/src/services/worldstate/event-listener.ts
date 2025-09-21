import { Argv, Context, Logger, Random, Session } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { truncate } from "@/shared/utils";
import { AssetService } from "../assets";
import { HistoryConfig } from "./config";
import { WorldStateService } from "./service";
import {
    AgentStimulus,
    MessageData,
    StimulusSource,
    SystemEventData,
    SystemEventPayload,
    SystemEventStimulus,
    UserMessagePayload,
    UserMessageStimulus,
} from "./types";

interface PendingCommand {
    commandEventId: string;
    scope: string;
    invokerId: string;
    timestamp: number;
}

export class EventListenerManager {
    private readonly disposers: (() => boolean)[] = [];
    private readonly pendingCommands = new Map<string, PendingCommand[]>();
    private logger: Logger;
    private assetService: AssetService;

    constructor(
        private ctx: Context,
        private service: WorldStateService,
        private config: HistoryConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[世界状态]");
        this.assetService = ctx[Services.Asset];
    }

    public start(): void {
        this.registerEventListeners();
    }

    public stop(): void {
        this.disposers.forEach((dispose) => dispose());
        this.disposers.length = 0;
    }

    public cleanupPendingCommands(): void {
        const now = Date.now();
        const expirationTime = 5 * 60 * 1000; // 5 分钟
        let cleanedCount = 0;

        for (const [channelId, commands] of this.pendingCommands.entries()) {
            const initialCount = commands.length;
            const activeCommands = commands.filter((cmd) => now - cmd.timestamp < expirationTime);
            cleanedCount += initialCount - activeCommands.length;

            if (activeCommands.length === 0) {
                this.pendingCommands.delete(channelId);
            } else {
                this.pendingCommands.set(channelId, activeCommands);
            }
        }
        if (cleanedCount > 0) {
            this.logger.debug(`清理了 ${cleanedCount} 个过期待定指令`);
        }
    }

    private registerEventListeners(): void {
        // 这个中间件记录用户消息，并触发响应流程
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                if (!this.service.isChannelAllowed(session)) {
                    return next();
                }

                if (session.author?.isBot) return next();

                await this.recordUserMessage(session);
                await next();

                if (!session["__commandHandled"] || !this.config.ignoreCommandMessage) {
                    const stimulus: UserMessageStimulus = {
                        type: StimulusSource.UserMessage,
                        payload: {
                            platform: session.platform,
                            channelId: session.channelId,
                            session: session,
                        },
                        priority: 5,
                        timestamp: new Date(),
                    };
                    this.ctx.emit("agent/stimulus-message", stimulus);
                }
            })
        );

        // 监听指令调用，记录指令事件
        this.disposers.push(
            this.ctx.on("command/before-execute", (argv) => {
                argv.session["__commandHandled"] = true;
                this.handleCommandInvocation(argv);
            })
        );

        // 在发送前匹配指令结果
        this.disposers.push(this.ctx.on("before-send", (session) => this.matchCommandResult(session), true));
        // 在发送后记录机器人消息
        this.disposers.push(this.ctx.on("after-send", (session) => this.recordBotSentMessage(session), true));

        // 记录从另一个设备手动发送的消息
        this.disposers.push(
            this.ctx.on("message", (session) => {
                if (!this.service.isChannelAllowed(session)) return;
                if (session.userId === session.bot.selfId && !session.scope) {
                    if (this.config.ignoreSelfMessage) return;
                    this.handleOperatorMessage(session);
                }
            })
        );

        // 监听系统事件，记录特定事件
        this.disposers.push(
            this.ctx.on("internal/session", (session) => {
                if (!this.service.isChannelAllowed(session)) return;

                if (session.type === "notice" && session.platform == "onebot") return this.handleNotice(session);
                if (session.type === "guild-member" && session.platform == "onebot") return this.handleGuildMember(session);
                if (session.type === "message-deleted") return this.handleMessageDeleted(session);
            })
        );
    }

    private async handleNotice(session: Session): Promise<void> {
        switch (session.subtype) {
            case "poke":
                const authorId = session.event._data.user_id;
                const targetId = session.event._data.target_id;
                const action = session.event._data.action;
                const suffix = session.event._data.suffix;

                const payload: Partial<SystemEventData> = {
                    type: "notice-poke",
                    payload: {
                        details: { authorId, targetId, action, suffix },
                    },
                    message: `系统提示：${authorId} ${action} ${targetId} ${suffix}`,
                };
                this.service.recordSystemEvent({
                    id: `sysevt_poke_${Random.id()}`,
                    platform: session.platform,
                    channelId: session.channelId,
                    timestamp: new Date(),
                    ...payload,
                } as SystemEventData);

                break;
        }
    }

    private async handleGuildMember(session: Session): Promise<void> {
        switch (session.subtype) {
            case "ban":
                const duration = session.event._data?.duration * 1000; // ms
                const isTargetingBot = session.event.user?.id === session.bot.selfId;

                if (duration < 0) {
                    // 全体禁言
                    const payload: Partial<SystemEventData> = {
                        type: "guild-all-member-ban",
                        payload: { details: { operator: session.event.operator, duration } },
                        message: `系统提示：管理员 "${session.event.operator?.id}" 开启了全体禁言`,
                    };
                    this.service.updateMuteStatus(session.cid, Number.POSITIVE_INFINITY);
                    this.service.recordSystemEvent({
                        id: `sysevt_ban_${Random.id()}`,
                        platform: session.platform,
                        channelId: session.channelId,
                        timestamp: new Date(),
                        ...payload,
                    } as SystemEventData);
                    return;
                }

                if (duration === 0) {
                    // 解除禁言
                    const payload: Partial<SystemEventData> = {
                        type: "guild-member-unban",
                        payload: { details: { user: session.event.user, operator: session.event.operator } },
                        message: `系统提示：管理员 "${session.event.operator?.id}" 已解除用户 "${session.event.user?.id}" 的禁言`,
                    };

                    if (isTargetingBot) {
                        this.service.updateMuteStatus(session.cid, 0);
                        const stimulus: SystemEventStimulus = {
                            type: StimulusSource.SystemEvent,
                            payload: {
                                eventType: payload.type,
                                details: (payload.payload as any)?.details || {},
                                message: payload.message || "",
                                session: session,
                            },
                            priority: 8,
                            timestamp: new Date(),
                        };
                        this.ctx.emit("agent/stimulus-system-event", stimulus);
                    }
                    this.service.recordSystemEvent({
                        id: `sysevt_unban_${Random.id()}`,
                        platform: session.platform,
                        channelId: session.channelId,
                        timestamp: new Date(),
                        ...payload,
                    } as SystemEventData);
                    return;
                }

                const payload: Partial<SystemEventData> = {
                    type: "guild-member-ban",
                    payload: { details: { user: session.event.user, operator: session.event.operator, duration } },
                    message: `系统提示：管理员 "${session.event.operator?.id}" 已将用户 "${session.event.user?.id}" 禁言，时长为 ${duration}ms`,
                };

                this.service.recordSystemEvent({
                    id: `sysevt_ban_${Random.id()}`,
                    platform: session.platform,
                    channelId: session.channelId,
                    timestamp: new Date(),
                    ...payload,
                } as SystemEventData);

                if (isTargetingBot) {
                    const expiresAt = duration > 0 ? Date.now() + duration : 0;
                    this.service.updateMuteStatus(session.cid, expiresAt);
                }

                break;
        }
    }

    private async handleMessageDeleted(session: Session): Promise<void> {
        const channelId = session.channelId;
        const messageId = session.messageId;
        const operator = session.operatorId;
    }

    private async handleOperatorMessage(session: Session): Promise<void> {
        this.logger.debug(`记录手动发送的消息 | 频道: ${session.cid}`);
        await this.recordBotSentMessage(session);
    }

    private async handleCommandInvocation(argv: Argv): Promise<void> {
        const { session, command, source } = argv;
        if (!session) return;

        this.logger.info(`记录指令调用 | 用户: ${session.author.name || session.userId} | 指令: ${command.name} | 频道: ${session.cid}`);
        const commandEventId = `cmd_invoked_${session.messageId || Random.id()}`;

        const eventPayload: SystemEventData = {
            id: commandEventId,
            platform: session.platform,
            channelId: session.channelId,
            type: "command-invoked",
            timestamp: new Date(),
            payload: {
                name: command.name,
                source,
                invoker: { pid: session.userId, name: session.author.nick || session.author.name },
            },
            message: `系统提示：用户 "${session.author.name || session.userId}" 调用了指令 "${command.name}"`,
        };

        await this.service.recordSystemEvent(eventPayload);

        const pendingList = this.pendingCommands.get(session.channelId) || [];
        pendingList.push({
            commandEventId,
            scope: session.scope,
            invokerId: session.userId,
            timestamp: Date.now(),
        });
        this.pendingCommands.set(session.channelId, pendingList);
    }

    private async matchCommandResult(session: Session): Promise<void> {
        if (!session.scope) return;

        const pendingInChannel = this.pendingCommands.get(session.channelId);
        if (!pendingInChannel?.length) return;

        const pendingIndex = pendingInChannel.findIndex((p) => p.scope === session.scope);
        if (pendingIndex === -1) return;

        const [pendingCmd] = pendingInChannel.splice(pendingIndex, 1);
        this.logger.debug(`匹配到指令结果 | 事件ID: ${pendingCmd.commandEventId}`);

        const [existingEvent] = await this.ctx.database.get(TableName.SystemEvents, { id: pendingCmd.commandEventId });
        if (existingEvent) {
            const updatedPayload = { ...existingEvent.payload, result: session.content };
            await this.ctx.database.set(TableName.SystemEvents, { id: pendingCmd.commandEventId }, { payload: updatedPayload });
        }
    }

    private async recordUserMessage(session: Session): Promise<void> {
        /* prettier-ignore */
        this.logger.info(`用户消息 | ${session.author.name} | 频道: ${session.cid} | 内容: ${truncate(session.content).replace(/\n/g, " ")}`);

        if (session.guildId) {
            await this.updateMemberInfo(session);
        }

        const content = await this.assetService.transform(session.content);
        this.logger.debug(`记录转义后的消息：${content}`);

        const message: MessageData = {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                id: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            content,
            timestamp: new Date(session.timestamp),
            quoteId: session.quote?.id,
        };
        await this.service.recordMessage(message);
    }

    private async recordBotSentMessage(session: Session): Promise<void> {
        if (!session.content || !session.messageId) return;

        this.logger.debug(`记录机器人消息 | 频道: ${session.cid} | 消息ID: ${session.messageId}`);

        const message: MessageData = {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: { id: session.bot.selfId, name: session.bot.user.nick || session.bot.user.name },
            content: session.content,
            timestamp: new Date(),
        };
        await this.service.recordMessage(message);
    }

    // TODO: 从平台适配器拉取用户信息
    private async updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author) return;

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
            } else {
                await this.ctx.database.create(TableName.Members, { ...memberKey, ...memberData });
            }
        } catch (error) {
            this.logger.error(`更新成员信息失败: ${error.message}`);
        }
    }
}
