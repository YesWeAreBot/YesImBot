import type { Context, Session } from "koishi";
import type { CommandService } from "../command";
import type { AnyPercept, MemberData, TimelineEntry, WorldState } from "./types";
import type { Config } from "@/config";

import { Service } from "koishi";
import { Services, TableName } from "@/shared/constants";
import { WorldStateBuilder } from "./builder";
import { EventListener } from "./listener";
import { EventRecorder } from "./recorder";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "agent/percept": (percept: AnyPercept) => void;
    }
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Timeline]: TimelineEntry;
    }
}

export class WorldStateService extends Service<Config> {
    static readonly inject = [Services.Model, Services.Asset, Services.Prompt, Services.Memory, Services.Command, "database"];

    public readonly recorder: EventRecorder;
    private builder: WorldStateBuilder;
    private listener: EventListener;

    private clearTimer: ReturnType<Context["setInterval"]> | null = null;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.WorldState, true);
        this.config = config;
        this.logger = this.ctx.logger("worldstate");
        this.logger.level = this.config.logLevel;

        this.recorder = new EventRecorder(ctx);
        this.builder = new WorldStateBuilder(ctx, config, this);
        this.listener = new EventListener(ctx, config, this);
    }

    protected async start(): Promise<void> {
        this.registerModels();

        this.listener.start();
        this.registerCommands();

        this.ctx.logger.info("服务已启动");
    }

    protected stop(): void {
        this.listener.stop();
        if (this.clearTimer) {
            this.clearTimer();
        }
        this.ctx.logger.info("服务已停止");
    }

    public async buildWorldState(percept: AnyPercept): Promise<WorldState> {
        return await this.builder.buildFromStimulus(percept);
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
            TableName.Timeline,
            {
                id: "string(255)",
                scopeId: "string(255)",
                eventType: "string(100)",
                priority: "unsigned",
                timestamp: "timestamp",
                eventData: "json",
            },
            {
                primary: ["id", "scopeId"],
                autoInc: false,
            },
        );
    }

    private registerCommands(): void {
        const commandService = this.ctx.get(Services.Command) as CommandService;
        const historyCmd = commandService.subcommand(".history", "历史记录管理指令集", { authority: 3 });

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
            .action(async ({ session, options }) => {});

        // const scheduleCmd = commandService.subcommand(".schedule", "计划任务管理指令集", { authority: 3 });

        // scheduleCmd
        //     .subcommand(".add", "添加计划任务")
        //     .option("name", "-n <name:string> 任务名称")
        //     .option("interval", "-i <interval:string> 执行间隔的 Cron 表达式")
        //     .option("action", "-a <action:string> 任务执行的操作描述")
        //     .usage("添加一个定时执行的任务")
        //     .example("schedule.add -n \"Daily Summary\" -i \"0 9 * * *\" -a \"Generate daily summary report\"")
        //     .action(async ({ session, options }) => {
        //         // Implementation for adding a scheduled task
        //         return "计划任务添加功能尚未实现";
        //     });

        // scheduleCmd
        //     .subcommand(".delay", "添加延迟任务")
        //     .option("name", "-n <name:string> 任务名称")
        //     .option("delay", "-d <delay:number> 延迟时间，单位为秒")
        //     .option("action", "-a <action:string> 任务执行的操作描述")
        //     .option("platform", "-p <platform:string> 指定平台")
        //     .option("channel", "-c <channel:string> 指定频道ID")
        //     .option("global", "-g 指定为全局任务")
        //     .usage("添加一个延迟执行的任务")
        //     .example("schedule.delay -n \"Reminder\" -d 3600 -a \"Send reminder message\"")
        //     .action(async ({ session, options }) => {
        //         if (!options.delay || isNaN(options.delay) || options.delay <= 0) {
        //             return "错误：请提供有效的延迟时间（秒）";
        //         }

        //         let platform, channelId;

        //         if (!options.global) {
        //             platform = options.platform || session.platform;
        //             channelId = options.channel || session.channelId;

        //             if (!platform || !channelId) {
        //                 return "错误：请指定有效的频道，或使用 -g 标记创建全局任务";
        //             }
        //         }

        //         this.ctx.setTimeout(() => {
        //             const percept: ScheduledTaskStimulus = {
        //                 type: StimulusSource.ScheduledTask,
        //                 priority: 1,
        //                 timestamp: new Date(),
        //                 payload: {
        //                     taskId: `delay-${Date.now()}`,
        //                     taskType: options.name || "delayed_task",
        //                     platform: options.global ? undefined : platform,
        //                     channelId: options.global ? undefined : channelId,
        //                     params: {},
        //                     message: options.action || "No action specified",
        //                 },
        //             };
        //             this.ctx.emit("agent/percept-scheduled-task", percept);
        //         }, options.delay * 1000);

        //         return `延迟任务 "${options.name}" 已设置，将在 ${options.delay} 秒后执行`;
        //     });

        // scheduleCmd
        //     .subcommand(".list", "列出所有计划任务")
        //     .usage("显示当前所有已设置的计划任务")
        //     .action(async ({ session, options }) => {
        //         // Implementation for listing scheduled tasks
        //         return "计划任务列表功能尚未实现";
        //     });

        // scheduleCmd
        //     .subcommand(".remove", "移除计划任务")
        //     .usage("移除指定名称的计划任务，例如: schedule.remove -n \"Daily Summary\"")
        //     .action(async ({ session, options }) => {
        //         // Implementation for removing a scheduled task
        //         return "计划任务移除功能尚未实现";
        //     });
    }
}
