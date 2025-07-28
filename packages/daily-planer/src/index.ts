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
    timeSegments: string[];
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
        timeSegments: Schema.array(String)
            .default(["上午", "下午", "晚上"])
            .role("table")
            .description("时间分段 (如上午/下午/晚上)"),
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
        
        this.ctx[Services.Tool].registerTool({
            name: 'update_schedule',
            description: '修改指定时间段的日程',
            parameters: Schema.object({
                timeSegment: Schema.string()
                    .required()
                    .description(`要修改的时间段: ${this.config.timeSegments.join("/")}`),
                newContent: Schema.string()
                    .required()
                    .description("新的日程内容")
            }),
            execute: this.updateSchedule.bind(this)
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
            const currentSegment = this.service.getCurrentTimeSegment();
            const schedule = await this.service.getTodaysSchedule();
            return Success({
                timeSegment: currentSegment,
                content: schedule.segments[currentSegment] || "暂无安排"
            });
        } catch (error) {
            return Failed(`获取当前日程失败: ${error.message}`);
        }
    }

    private async updateSchedule({ timeSegment, newContent }: Infer<{ 
        timeSegment: string; newContent: string 
    }>) {
        try {
            const updated = await this.service.updateScheduleSegment(timeSegment, newContent);
            return Success(updated);
        } catch (error) {
            return Failed(`更新日程失败: ${error.message}`);
        }
    }
}