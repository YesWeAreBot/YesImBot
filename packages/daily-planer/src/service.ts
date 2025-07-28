import { Context, Logger } from "koishi";
import { DailyPlannerConfig } from ".";
import { IChatModel, TaskType, MemoryService, MemoryBlockData, LoggerService } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { Session } from "inspector/promises";

// 日程数据结构
interface DailySchedule {
    date: string; // YYYY-MM-DD
    segments: Record<string, string>; // 时间段 -> 内容
    memoryContext?: string[]; // 关联的记忆ID
}

declare module "koishi" {
    interface Tables {
		'yesimbot.daily_schedules': DailySchedule;
    }
}


export class DailyPlannerService {
    private readonly memoryService: MemoryService;
    private readonly chatModel: IChatModel;
    private readonly logger: Logger;
    
    constructor(
        private ctx: Context,
        private config: DailyPlannerConfig
    ) {
        this.memoryService = ctx[Services.Memory];
        this.chatModel = ctx[Services.Model].useChatGroup(TaskType.Summarization)?.current;
        this.logger = ctx[Services.Logger].getLogger("[日程规划]");
    }

    // 生成今日日程
    public async generateDailySchedule(): Promise<DailySchedule> {
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 获取核心记忆和近期事件
        const coreMemories = await this.getCoreMemories();
        const recentEvents = await this.ctx["yesimbot.memory"].searchMemories("我最近要做的事");
        
        // 2. 构建提示词
        const prompt = this.buildSchedulePrompt(coreMemories, recentEvents.data?.map(d => d.content) || []);
        
        // 3. 调用模型生成日程
        const generatedSchedule = await this.generateWithModel(prompt);
        
        // 4. 解析并存储日程
        const parsedSchedule = this.parseScheduleOutput(generatedSchedule);
        const fullSchedule: DailySchedule = {
            date: today,
            segments: parsedSchedule,
            memoryContext: [...coreMemories.map(m => m.label), ...recentEvents.data?.map(e => e.id)]
        };
        
        await this.saveSchedule(fullSchedule);
        return fullSchedule;
    }

    // 获取今日日程
    public async getTodaysSchedule(): Promise<DailySchedule> {
        const today = new Date().toISOString().split('T')[0];
        const schedule = await this.ctx.database.get('yesimbot.daily_schedules', { date: today });
        
        if (!schedule.length) {
            this.logger.info("今日日程未生成，正在创建...");
            return this.generateDailySchedule();
        }
        return schedule[0];
    }

    // 更新日程时间段
    public async updateScheduleSegment(
        segment: string,
        newContent: string
    ): Promise<DailySchedule> {
        const schedule = await this.getTodaysSchedule();
        
        if (!this.config.timeSegments.includes(segment)) {
            throw new Error(`无效时间段: ${segment}`);
        }
        
        schedule.segments[segment] = newContent;
        await this.saveSchedule(schedule);
        return schedule;
    }

    // 获取当前时间段
    public getCurrentTimeSegment(): string {
        const hour = new Date().getHours();
        
        if (this.config.timeSegments.length === 3) {
            // 默认上午/下午/晚上分段
            if (hour < 12) return this.config.timeSegments[0];
            if (hour < 18) return this.config.timeSegments[1];
            return this.config.timeSegments[2];
        }
        
        // 自定义时间段处理
        return this.config.timeSegments[0];
    }

    // --- 私有方法 ---
    
    private async getCoreMemories(): Promise<MemoryBlockData[]> {
        try {
            const blocks = await this.memoryService.getMemoryBlocksForRendering();
            return blocks.filter(b => 
                b.label.includes("核心") || 
                b.label.includes("使命")
            );
        } catch {
            return [];
        }
    }
    
    private buildSchedulePrompt(coreMemories: MemoryBlockData[], recentEvents: any[]): string {
        let prompt = "你是一个AI助手，请基于以下信息规划今日日程：\n\n";
        
        // 添加核心记忆
        prompt += "## 核心记忆:\n";
        coreMemories.forEach((memory, i) => {
            prompt += `${i + 1}. ${memory.title}: ${truncate(memory.content.join(" "), 200)}\n`;
        });
        
        // 添加近期事件
        if (recentEvents.length) {
            prompt += "\n## 近期事件:\n";
            recentEvents.forEach((event, i) => {
                prompt += `${i + 1}. [${formatDate(event.timestamp)}] ${event.type}: ${event.details}\n`;
            });
        }
        
        // 添加时间分段
        prompt += `\n## 时间分段:\n请按以下时间段规划日程: ${this.config.timeSegments.join(", ")}\n`;
        prompt += "每个时间段用1-2句话描述主要活动，使用自然语言。";
        
        return prompt;
    }
    
    private async generateWithModel(prompt: string): Promise<string> {
        if (!this.chatModel) {
            throw new Error("日程生成模型不可用");
        }
        
        const response = await this.chatModel.chat({
            messages: [{
                role: "system",
                content: "你是一个专业的日程规划助手，请根据提供的信息创建合理高效的日程安排。"
            }, {
                role: "user",
                content: prompt
            }],
            temperature: 0.3
        });
        
        return response.text;
    }
    
    private parseScheduleOutput(text: string): Record<string, string> {
        const segments: Record<string, string> = {};
        
        // 尝试按时间段解析
        this.config.timeSegments.forEach(segment => {
            const regex = new RegExp(`${segment}[:：]\\s*([^\\n]+)`);
            const match = text.match(regex);
            if (match) segments[segment] = match[1].trim();
        });
        
        // 如果无法解析，使用默认分配
        if (Object.keys(segments).length === 0) {
            this.config.timeSegments.forEach(segment => {
                segments[segment] = "处理用户请求和系统任务";
            });
        }
        
        return segments;
    }
    
    private async saveSchedule(schedule: DailySchedule): Promise<void> {
        await this.ctx.database.upsert('yesimbot.daily_schedules', [schedule], ['date']);
    }
}

// 辅助函数
function truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}

function formatDate(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}