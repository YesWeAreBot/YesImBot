import type { Context } from "koishi";
import type { ModelDescriptor, PromptService } from "koishi-plugin-yesimbot/services";
import { Schema } from "koishi";
import {} from "koishi-plugin-cron";
import { Failed, Metadata, Plugin, Success, Tool } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { DailyPlannerService } from "./service";

export interface DailyPlannerConfig {
    scheduleGenerationTime: string;
    model: ModelDescriptor;
    coreMemoryLabel: string[];
    characterName: string;
    coreMemoryWeight: number;
}

@Metadata({
    name: "daily-planner",
    display: "日程规划",
    description: "基于AI记忆的每日日程规划与管理",
    author: "HydroGest",
    version: "1.0.0",
})
export default class DailyPlannerExtension extends Plugin<DailyPlannerConfig> {
    static readonly inject = [
        "cron",
        "database",
        "yesimbot",
        Services.Prompt,
        Services.Plugin,
        Services.Model,
        Services.Memory,
        Services.Horizon,
    ];

    static readonly Config: Schema<DailyPlannerConfig> = Schema.object({
        scheduleGenerationTime: Schema.string().default("03:00").description("每日生成日程的时间 (HH:mm 格式)"),
        characterName: Schema.string().required().description("日程的主体，也就是 Bot 的名称"),
        coreMemoryLabel: Schema.array(String).default(["persona"]).description("用于生成日程的描述 Bot 的核心记忆"),
        model: Schema.dynamic("modelService.selectableModels").description("用于生成日程表的模型"),
        coreMemoryWeight: Schema.number().default(0.7).min(0).max(1).description("核心记忆在日程生成中的权重"),
    });

    private service: DailyPlannerService;

    constructor(
        ctx: Context,
        config: DailyPlannerConfig,
    ) {
        super(ctx, config);
        this.service = new DailyPlannerService(ctx, config);

        // 将 HH:mm 格式转换为 cron 表达式
        const [hours, minutes] = config.scheduleGenerationTime.split(":").map(Number);
        const cronExpression = `${minutes} ${hours} * * *`;

        // 注册每日定时任务
        ctx.cron(cronExpression, async () => {
            await this.service.generateDailySchedule();
        });

        ctx.on("ready", () => {
            const promptService: PromptService = ctx.get(Services.Prompt);

            promptService.inject("daily_plan", 0, async () => {
                const currentSchedule = await this.getCurrentSchedule();

                return `现在是 {{ date.now }}，当前时段的安排为：${currentSchedule}。`;
            });

            this.registerCommands();
        });
    }

    private registerCommands() {
        // 手动生成今日日程
        this.ctx.command("daily.generate", "手动生成今日日程", { authority: 3 }).action(async ({ session }) => {
            session.sendQueued("正在生成日程，请稍后...");
            await this.service.generateDailySchedule();

            return `生成成功`;
        });

        // // 强制覆盖今日日程
        // this.ctx.command('daily.override <content>', '覆盖当前时段安排', { authority: 3 })
        //     .option('duration', '-d <minutes>', { fallback: 60 })
        //     .action(async ({ session, options }, content) => {
        //         const duration = options.duration || 60;
        //         await this.service.overrideCurrentSchedule(content, duration);
        //         await this.registerTools();
        //         return `当前时段安排已更新为：${content}`;
        //     });

        // // 添加自定义时段
        // this.ctx.command('daily.add <start> <end> <content>', '添加自定义时段', { authority: 3 })
        //     .action(async ({ session }, start, end, content) => {
        //         await this.service.addCustomTimeSegment(start, end, content);
        //         await this.registerTools();
        //         return `已添加时段：${start}-${end}: ${content}`;
        //     });

        // // 删除时段
        // this.ctx.command('daily.remove <index>', '删除指定时段', { authority: 3 })
        //     .action(async ({ session }, index) => {
        //         const idx = parseInt(index) - 1;
        //         await this.service.removeTimeSegment(idx);
        //         await this.registerTools();
        //         return `已删除第 ${index} 个时段安排`;
        //     });

        // 查看今日日程
        this.ctx.command("daily.show", "查看今日完整日程").action(async ({ session }) => {
            const schedule = await this.service.getTodaysSchedule();
            return schedule.segments.map((s, i) => `${i + 1}. ${s.start}-${s.end}: ${s.content}`).join("\n");
        });
    }

    @Tool({
        name: "get_daily_schedule",
        description: `获取今天的完整日程安排。`,
        parameters: Schema.object({}),
    })
    public async getFullSchedule() {
        try {
            const schedule = await this.service.getTodaysSchedule();
            return Success(schedule);
        } catch (error: any) {
            return Failed(`获取日程失败: ${error.message}`);
        }
    }

    private async getCurrentSchedule() {
        try {
            const currentSegment = await this.service.getCurrentTimeSegment();
            if (!currentSegment) {
                return "当前没有安排活动，为休息或自由时间";
            }

            return `${currentSegment.start}-${currentSegment.end}: ${currentSegment.content}`;
        } catch (error: any) {
            return `获取当前日程失败: ${error.message}`;
        }
    }
}
