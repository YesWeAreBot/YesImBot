import type { Context, Query, Session } from "koishi";
import type { CommandService } from "../command";
import type {
    AgentStimulus,
    AnyAgentStimulus,
    AnyWorldState,
    BackgroundTaskCompletionStimulus,
    ChannelEventPayloadData,
    ChannelEventStimulus,
    EventData,
    GlobalEventPayloadData,
    GlobalEventStimulus,
    MemberData,
    MessagePayload,
    ScheduledTaskStimulus,
    UserMessageStimulus,
} from "./types";
import type { Config } from "@/config";

import { $, Random, Service } from "koishi";
import { Services, TableName } from "@/shared/constants";
import { ContextBuilder } from "./context-builder";
import { EventListenerManager } from "./event-listener";
import { HistoryManager } from "./history-manager";
import { StimulusSource } from "./types";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "agent/stimulus": (stimulus: AgentStimulus<any>) => void;
        "agent/stimulus-channel-event": (stimulus: ChannelEventStimulus) => void;
        "agent/stimulus-user-message": (stimulus: UserMessageStimulus) => void;
        "agent/stimulus-global-event": (stimulus: GlobalEventStimulus) => void;
        "agent/stimulus-scheduled-task": (stimulus: ScheduledTaskStimulus) => void;
        "agent/stimulus-background-task-completion": (stimulus: BackgroundTaskCompletionStimulus) => void;
    }
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Events]: EventData;
    }
}

export class WorldStateService extends Service<Config> {
    static readonly inject = [Services.Model, Services.Asset, Services.Prompt, Services.Memory, Services.Command, "database"];

    public readonly history: HistoryManager;
    private contextBuilder: ContextBuilder;
    private eventListenerManager: EventListenerManager;

    private clearTimer: ReturnType<Context["setInterval"]> | null = null;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.WorldState, true);
        this.config = config;
        this.logger = this.ctx.logger("worldstate");
        this.logger.level = this.config.logLevel;

        this.history = new HistoryManager(ctx);
        this.contextBuilder = new ContextBuilder(ctx, config, this.history);
        this.eventListenerManager = new EventListenerManager(ctx, this, config);
    }

    protected async start(): Promise<void> {
        this.registerModels();

        this.eventListenerManager.start();
        this.registerCommands();

        this.ctx.logger.info("服务已启动");
    }

    protected stop(): void {
        this.eventListenerManager.stop();
        if (this.clearTimer) {
            this.clearTimer();
        }
        this.ctx.logger.info("服务已停止");
    }

    public async buildWorldState(stimulus: AnyAgentStimulus): Promise<AnyWorldState> {
        return await this.contextBuilder.buildFromStimulus(stimulus);
    }

    /* prettier-ignore */
    public async recordMessage(message: MessagePayload & { platform: string; channelId: string }): Promise<void> {
        await this.ctx.database.create(TableName.Events, {
            id: Random.id(),
            type: "message",
            timestamp: new Date(),
            platform: message.platform,
            channelId: message.channelId,
            payload: {
                id: message.id,
                sender: message.sender,
                content: message.content,
                quoteId: message.quoteId,
            },
        });
    }

    /* prettier-ignore */
    public async recordEvent(event: Omit<EventData, "id" | "type" | "timestamp"> & { type: "channel_event" | "global_event" }): Promise<void> {
        await this.ctx.database.create(TableName.Events, {
            id: Random.id(),
            type: event.type,
            timestamp: new Date(),
            platform: event.platform,
            channelId: event.channelId,
            payload: event.payload,
        });
    }

    /* prettier-ignore */
    public async recordChannelEvent(platform: string, channelId: string, eventPayload: ChannelEventPayloadData): Promise<void> {
        this.recordEvent({
            type: "channel_event",
            platform,
            channelId,
            payload: eventPayload,
        });
    }

    public async recordGlobalEvent(eventPayload: GlobalEventPayloadData): Promise<void> {
        this.recordEvent({
            type: "global_event",
            payload: eventPayload,
        });
    }

    public isChannelAllowed(session: Session): boolean {
        const { platform, channelId, guildId, isDirect, userId } = session;
        return this.config.allowedChannels.some((c) => {
            return (
                c.platform === platform
                && (c.type === "private" ? isDirect : true)
                && (c.id === "*" || c.id === channelId || (guildId && c.id === guildId) || (c.type === "private" && c.id === userId))
            );
        });
    }

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
            { autoInc: false, primary: ["pid", "platform", "guildId"] },
        );

        this.ctx.model.extend(
            TableName.Events,
            {
                id: "string(255)",
                type: "string(50)",
                timestamp: "timestamp",
                platform: "string(255)",
                channelId: "string(255)",
                payload: "json",
            },
            { primary: "id" },
        );
    }

    private registerCommands(): void {
        const commandService = this.ctx.get(Services.Command) as CommandService;
        const historyCmd = commandService.subcommand(".history", "历史记录管理指令集", { authority: 3 });

        historyCmd
            .subcommand(".count", "统计历史记录中激活的消息数量")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID")
            .option("target", "-t <target:string> 指定目标 'platform:channelId'")
            .action(async ({ session, options }) => {
                let platform = options.platform || session.platform;
                let channelId = options.channel || session.channelId;

                // 从 -t, --target 解析
                if (options.target) {
                    const parts = options.target.split(":");
                    if (parts.length < 2) {
                        return `目标格式错误: "${options.target}"，已跳过`;
                    }
                    platform = parts[0];
                    channelId = parts.slice(1).join(":");
                }

                if (channelId) {
                    if (!platform) {
                        const messages = await this.ctx.database.get(TableName.Events, { channelId }, { fields: ["platform"] });
                        const platforms = [...new Set(messages.map(d => d.platform))];

                        if (platforms.length === 0)
                            return `频道 "${channelId}" 未找到任何历史记录，已跳过`;
                        if (platforms.length === 1)
                            platform = platforms[0];
                        else
                            /* prettier-ignore */
                            return `频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}请使用 -p <platform> 来指定`;
                    }

                    const messageCount = await this.ctx.database.eval(TableName.Events, row => $.count(row.id), {
                        type: "message",
                        platform,
                        channelId,
                    });

                    /* prettier-ignore */
                    return `在 ${platform}:${channelId} 中有 ${messageCount} 条消息，上下文中最多保留 ${this.config.l1_memory.maxMessages} 条`;
                }
            });

        historyCmd
            .subcommand(".clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道 (private, guild, all)")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)")
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)")
            .usage(`清除历史记录上下文\n从数据库中永久移除相关对话、消息和系统事件，此操作不可恢复`)
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -a private           # 清除所有私聊频道的历史记录",
                ].join("\n"),
            )
            .action(async ({ session, options }) => {
                const results: string[] = [];

                const performClear = async (
                    query: Query.Expr<EventData>,
                    description: string,
                    target?: { platform: string; channelId: string },
                ) => {
                    try {
                        const { removed: messagesRemoved } = await this.ctx.database.remove(TableName.Events, {
                            ...query,
                            type: "message",
                        });
                        const { removed: eventsRemoved } = await this.ctx.database.remove(TableName.Events, {
                            ...query,
                            type: "channel_event",
                        });

                        results.push(`${description} - 操作成功，共删除了 ${messagesRemoved} 条消息, ${eventsRemoved} 个系统事件`);
                    }
                    catch (error: any) {
                        this.ctx.logger.warn(`为 ${description} 清理历史记录时失败:`, error);
                        results.push(`${description} - 操作失败`);
                    }
                };

                if (options.all) {
                    if (options.all === undefined)
                        return "错误：-a 的参数必须是 'private', 'guild', 或 'all'";
                    let query: Query.Expr<EventData> = {};
                    let description = "";
                    switch (options.all) {
                        case "private":
                            query = { channelId: { $regex: /^private:/ } };
                            description = "所有私聊频道";
                            break;
                        case "guild":
                            query = { channelId: { $not: { $regex: /^private:/ } } };
                            description = "所有群聊频道";
                            break;
                        case "all":
                            query = {};
                            description = "所有频道";
                            break;
                    }
                    await performClear(query, description);
                    return results.join("\n");
                }

                const targetsToProcess: { platform: string; channelId: string }[] = [];
                const ambiguousChannels: string[] = [];

                if (options.target) {
                    for (const target of options.target
                        .split(",")
                        .map(t => t.trim())
                        .filter(Boolean)) {
                        const parts = target.split(":");
                        if (parts.length < 2) {
                            results.push(`❌ 格式错误的目标: "${target}"`);
                            continue;
                        }
                        targetsToProcess.push({ platform: parts[0], channelId: parts.slice(1).join(":") });
                    }
                }

                if (options.channel) {
                    for (const channelId of options.channel
                        .split(",")
                        .map(c => c.trim())
                        .filter(Boolean)) {
                        if (options.platform) {
                            targetsToProcess.push({ platform: options.platform, channelId });
                        }
                        else {
                            const messages = await this.ctx.database.get(TableName.Events, { channelId }, { fields: ["platform"] });
                            const platforms = [...new Set(messages.map(d => d.platform))];
                            if (platforms.length === 0)
                                results.push(`🟡 频道 "${channelId}" 未找到`);
                            else if (platforms.length === 1)
                                targetsToProcess.push({ platform: platforms[0], channelId });
                            else ambiguousChannels.push(`频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}`);
                        }
                    }
                }

                if (ambiguousChannels.length > 0)
                    return `操作已中止:\n${ambiguousChannels.join("\n")}\n请使用 -p 或 -t 指定平台`;

                if (targetsToProcess.length === 0 && !options.target && !options.channel) {
                    if (session.platform && session.channelId)
                        targetsToProcess.push({ platform: session.platform, channelId: session.channelId });
                    else return "无法确定当前会话，请使用选项指定频道";
                }

                if (targetsToProcess.length === 0 && results.length === 0)
                    return "没有指定任何有效的清理目标";

                for (const target of targetsToProcess) {
                    await performClear(
                        { platform: target.platform, channelId: target.channelId },
                        `目标 "${target.platform}:${target.channelId}"`,
                        target,
                    );
                }

                return `--- 清理报告 ---\n${results.join("\n")}`;
            });

        const scheduleCmd = commandService.subcommand(".schedule", "计划任务管理指令集", { authority: 3 });

        scheduleCmd
            .subcommand(".add", "添加计划任务")
            .option("name", "-n <name:string> 任务名称")
            .option("interval", "-i <interval:string> 执行间隔的 Cron 表达式")
            .option("action", "-a <action:string> 任务执行的操作描述")
            .usage("添加一个定时执行的任务")
            .example("schedule.add -n \"Daily Summary\" -i \"0 9 * * *\" -a \"Generate daily summary report\"")
            .action(async ({ session, options }) => {
                // Implementation for adding a scheduled task
                return "计划任务添加功能尚未实现";
            });

        scheduleCmd
            .subcommand(".delay", "添加延迟任务")
            .option("name", "-n <name:string> 任务名称")
            .option("delay", "-d <delay:number> 延迟时间，单位为秒")
            .option("action", "-a <action:string> 任务执行的操作描述")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID")
            .option("global", "-g 指定为全局任务")
            .usage("添加一个延迟执行的任务")
            .example("schedule.delay -n \"Reminder\" -d 3600 -a \"Send reminder message\"")
            .action(async ({ session, options }) => {
                if (!options.delay || isNaN(options.delay) || options.delay <= 0) {
                    return "错误：请提供有效的延迟时间（秒）";
                }

                let platform, channelId;

                if (!options.global) {
                    platform = options.platform || session.platform;
                    channelId = options.channel || session.channelId;

                    if (!platform || !channelId) {
                        return "错误：请指定有效的频道，或使用 -g 标记创建全局任务";
                    }
                }

                this.ctx.setTimeout(() => {
                    const stimulus: ScheduledTaskStimulus = {
                        type: StimulusSource.ScheduledTask,
                        priority: 1,
                        timestamp: new Date(),
                        payload: {
                            taskId: `delay-${Date.now()}`,
                            taskType: options.name || "delayed_task",
                            platform: options.global ? undefined : platform,
                            channelId: options.global ? undefined : channelId,
                            params: {},
                            message: options.action || "No action specified",
                        },
                    };
                    this.ctx.emit("agent/stimulus-scheduled-task", stimulus);
                }, options.delay * 1000);

                return `延迟任务 "${options.name}" 已设置，将在 ${options.delay} 秒后执行`;
            });

        scheduleCmd
            .subcommand(".list", "列出所有计划任务")
            .usage("显示当前所有已设置的计划任务")
            .action(async ({ session, options }) => {
                // Implementation for listing scheduled tasks
                return "计划任务列表功能尚未实现";
            });

        scheduleCmd
            .subcommand(".remove", "移除计划任务")
            .usage("移除指定名称的计划任务，例如: schedule.remove -n \"Daily Summary\"")
            .action(async ({ session, options }) => {
                // Implementation for removing a scheduled task
                return "计划任务移除功能尚未实现";
            });
    }
}
