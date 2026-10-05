import { Argv, Context, Logger, Random, Session } from "koishi";
import type { Universal } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { truncate } from "@/shared/utils";
import { AssetService } from "../assets";
import { HistoryConfig } from "./config";
import { WorldStateService } from "./service";
import { AgentStimulus, MessageData, SystemEventData, SystemEventPayload, UserMessagePayload } from "./types";

interface PendingCommand {
    commandEventId: string;
    scope: string;
    invokerId: string;
    timestamp: number;
    session: Session;
}

export class EventListenerManager {
    private readonly disposers: (() => boolean)[] = [];
    private readonly pendingCommands = new Map<string, PendingCommand[]>();
    private cleanupTimer?: () => void;
    private generation = 0;
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
        if (this.cleanupTimer) return;
        this.registerEventListeners();
        this.cleanupTimer = this.ctx.setInterval(() => this.cleanupPendingCommands(), 60 * 1000);
    }

    public stop(): void {
        this.generation++;
        this.cleanupTimer?.();
        this.cleanupTimer = undefined;
        this.disposers.forEach((dispose) => dispose());
        this.disposers.length = 0;
        this.pendingCommands.clear();
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
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                if (!this.service.isChannelAllowed(session)) {
                    return next();
                }

                if (session.author?.isBot) return next();

                await this.recordUserMessage(session);
                await next();

                if (!session["__commandHandled"]) {
                    // 等待所有前置处理结束；单个插件失败不能提前触发回复。
                    const hooks = this.ctx.lifecycle.filterHooks(
                        this.ctx.lifecycle._hooks["yesimbot/before-user-stimulus"] || [],
                        session
                    );
                    const results = await Promise.allSettled(
                        hooks.map((hook) => Promise.resolve().then(() => hook.callback.call(session, session)))
                    );
                    for (const result of results) {
                        if (result.status === "rejected") this.logger.error("用户消息前置处理失败", result.reason);
                    }
                    const stimulus: AgentStimulus<UserMessagePayload> = {
                        type: "user_message",
                        channelCid: session.cid,
                        session,
                        priority: 5, // Normal message priority
                        payload: { messageIds: [session.messageId] },
                    };
                    this.ctx.emit("agent/stimulus", stimulus);
                }
            })
        );

        this.disposers.push(
            this.ctx.on("command/before-execute", (argv) => {
                argv.session["__commandHandled"] = true;
                return this.handleCommandInvocation(argv);
            })
        );

        this.disposers.push(this.ctx.on("before-send", (session, options) => this.matchCommandResult(session, options), true));
        this.disposers.push(this.ctx.on("after-send", (session) => this.recordBotSentMessage(session), true));

        this.disposers.push(
            this.ctx.on("message", (session) => {
                if (!this.service.isChannelAllowed(session)) return;
                if (session.userId === session.bot.selfId && !session.scope) {
                    if (this.config.ignoreSelfMessage) return;
                    this.handleOperatorMessage(session);
                }
            })
        );

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
        if (session.subtype !== "ban") return;
        const raw = session.event._data;
        if (typeof raw?.duration !== "number" && typeof raw?.duration !== "string") return;
        if (typeof raw.duration === "string" && !raw.duration.trim()) return;
        const seconds = Number(raw?.duration);
        if (!Number.isFinite(seconds)) return;
        const duration = seconds * 1000;
        if (!Number.isFinite(duration)) return;
        const selfId = session.selfId || session.bot.selfId;
        const userId = session.event.user?.id ?? (raw?.user_id === undefined ? undefined : String(raw.user_id));
        const allMembers = String(raw?.user_id) === "0" || (duration < 0 && userId === undefined);
        if (!allMembers && (!userId || duration < 0)) return;
        const released = raw?.sub_type === "lift_ban" || duration === 0;
        const timestamp = new Date();
        const isTargetingBot = userId === selfId;
        const type = allMembers
            ? released
                ? "guild-all-member-unban"
                : "guild-all-member-ban"
            : released
              ? "guild-member-unban"
              : "guild-member-ban";
        const payload: Partial<SystemEventData> = {
            type,
            payload: {
                details: {
                    user: userId === undefined ? undefined : { ...session.event.user, id: userId },
                    operator: session.event.operator,
                    duration,
                    selfId,
                },
            },
            message: allMembers
                ? `系统提示：管理员 "${session.event.operator?.id}" ${released ? "解除了" : "开启了"}全体禁言`
                : released
                  ? `系统提示：管理员 "${session.event.operator?.id}" 已解除用户 "${userId}" 的禁言`
                  : `系统提示：管理员 "${session.event.operator?.id}" 已将用户 "${userId}" 禁言，时长为 ${duration}ms`,
        };

        if (allMembers) {
            await this.service.updateMuteStatus(session.cid, released ? 0 : Infinity, selfId, "all");
        } else if (isTargetingBot || this.ctx.bots.some(bot => bot.platform === session.platform && bot.selfId === userId)) {
            await this.service.updateMuteStatus(session.cid, released ? 0 : timestamp.getTime() + duration, userId);
        }
        await this.service.recordSystemEvent({
            id: `sysevt_${released ? "unban" : "ban"}_${Random.id()}`,
            platform: session.platform,
            channelId: session.channelId,
            timestamp,
            ...payload,
        } as SystemEventData);
        if (!allMembers && released && isTargetingBot && !this.service.isBotMuted(session.cid, selfId)) {
            const stimulus: AgentStimulus<SystemEventPayload> = {
                type: "system_event",
                channelCid: session.cid,
                session,
                priority: 8,
                payload: payload as SystemEventPayload,
            };
            this.ctx.emit("agent/stimulus", stimulus);
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
        const generation = this.generation;

        this.logger.info(`记录指令调用 | 用户: ${session.author.name || session.userId} | 指令: ${command.name} | 频道: ${session.cid}`);
        const commandEventId = `cmd_invoked_${session.messageId || "call"}_${Random.id()}`;

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
        if (generation !== this.generation) return;

        const key = this.commandKey(session);
        const pendingList = this.pendingCommands.get(key) || [];
        pendingList.push({
            commandEventId,
            scope: session.scope,
            invokerId: session.userId,
            timestamp: Date.now(),
            session,
        });
        this.pendingCommands.set(key, pendingList);
    }

    private commandKey(session: Session): string {
        return JSON.stringify([session.platform, session.channelId, session.selfId || session.bot?.selfId]);
    }

    private async matchCommandResult(session: Session, options?: Universal.SendOptions): Promise<void> {
        this.cleanupPendingCommands();
        if (!session.scope || !options?.session) return;

        const key = this.commandKey(session);
        const pendingInChannel = this.pendingCommands.get(key);
        if (!pendingInChannel?.length) return;

        // command scope 是固定作用域；真实编码器通过 options.session 传递调用者。
        // 同一个 Session 并发执行同名命令仍有歧义，宁可不关联也不能猜测 FIFO。
        const candidates = pendingInChannel.filter(p => p.session === options.session && p.scope === session.scope);
        if (candidates.length !== 1) return;
        const pendingIndex = pendingInChannel.indexOf(candidates[0]);

        const [pendingCmd] = pendingInChannel.splice(pendingIndex, 1);
        if (!pendingInChannel.length) this.pendingCommands.delete(key);
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

        // 使用原生序列化还原被分离到 session.quote 的引用元素。
        const messageContent = session.toJSON().message?.content ?? session.content;
        const content = await this.assetService.transform(messageContent);
        this.logger.debug(`记录转义后的消息：${content}`);

        const message: MessageData = {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                id: session.userId,
                name: session.author.nick || session.author.name,
                roles: roleIds(session.author.roles),
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

    private async updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author) return;

        try {
            const memberKey = { pid: session.userId, platform: session.platform, guildId: session.guildId };
            const memberData = {
                name: session.author.nick || session.author.name,
                roles: roleIds(session.author.roles),
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
// #endregion

/** 兼容旧适配器的角色 ID 数组及新版 Satori 的角色对象数组。 */
function roleIds(roles?: readonly (string | { id: string })[]): string[] | undefined {
    return roles?.map(role => typeof role === "string" ? role : role.id);
}
