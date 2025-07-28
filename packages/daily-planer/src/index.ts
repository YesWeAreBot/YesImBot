import { Context, Schema } from "koishi";
import { Extension, Failed, Infer, ModelDescriptor, Success, Tool } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { DailyPlannerService } from './service';
import {} from "koishi-plugin-cron"

export interface DailyPlannerConfig {
    scheduleGenerationTime: string;
    model: ModelDescriptor;
    coreMemoryLabel: string[];
    characterName: string;
    coreMemoryWeight: number;
}

@Extension({
    name: "daily-planner",
    display: "日程规划",
    description: "基于AI记忆的每日日程规划与管理",
    author: "HydroGest",
    version: "1.0.0",
})
export default class DailyPlannerExtension {
    static readonly inject = ["cron", "database", "yesimbot.model", "yesimbot.memory"];

    static readonly Config: Schema<DailyPlannerConfig> = Schema.object({
        scheduleGenerationTime: Schema.string()
            .default("03:00")
            .description("每日生成日程的时间 (HH:mm 格式)"),
        characterName: Schema.string().required().description("日程的主体，也就是 Bot 的名称"),
        coreMemoryLabel: Schema.array(String).default(["persona"]).description("用于生成日程的描述 Bot 的核心记忆"),
        model: Schema.dynamic("modelService.selectableModels")
            .description("用于生成日程表的模型"),
        coreMemoryWeight: Schema.number()
            .default(0.7)
            .min(0).max(1)
            .description("核心记忆在日程生成中的权重"),
    });

    private service: DailyPlannerService;

    constructor(public ctx: Context, public config: DailyPlannerConfig) {
        this.service = new DailyPlannerService(ctx, config);
 
        // 将 HH:mm 格式转换为 cron 表达式
        const [hours, minutes] = config.scheduleGenerationTime.split(':').map(Number);
        const cronExpression = `${minutes} ${hours} * * *`;
        
        // 注册每日定时任务
        ctx.cron(cronExpression, async () => {
            await this.service.generateDailySchedule();
        });
        
        ctx.on("ready", () => this.registerTools());
    }

    private registerTools() {
        // 注册日程管理工具
        this.ctx[Services.Tool].registerTool({
            name: 'get_daily_schedule',
            description: '获取今天的完整日程安排',
            parameters: Schema.object({}),
            execute: this.getFullSchedule.bind(this)
        });
        
        this.ctx[Services.Tool].registerTool({
            name: 'get_current_schedule',
            description: '获取当前时间段的日程安排',
            parameters: Schema.object({}),
            execute: this.getCurrentSchedule.bind(this)
        });
    }

    private async getFullSchedule() {
        try {
            const schedule = await this.service.getTodaysSchedule();
            return Success(schedule);
        } catch (error) {
            return Failed(`获取日程失败: ${error.message}`);
        }
    }

    private async getCurrentSchedule() {
        try {
            const currentSegment = await this.service.getCurrentTimeSegment();
            if (!currentSegment) {
                return Success({
                    message: "当前没有安排活动",
                    content: "休息或自由时间"
                });
            }
            
            return Success({
                start: currentSegment.start,
                end: currentSegment.end,
                content: currentSegment.content
            });
        } catch (error) {
            return Failed(`获取当前日程失败: ${error.message}`);
        }
    }
}