import { Context, Logger } from "koishi";
import { DailyPlannerConfig } from ".";
import { IChatModel, TaskType, MemoryService, MemoryBlockData, LoggerService } from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import { debug } from "console";
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
        this.chatModel = ctx[Services.Model].getChatModel(this.config.model.providerName, config.model.modelId);
        this.logger = ctx[Services.Logger].getLogger("[日程规划]");
        this.registerDatabaseModel();
        this.logger.info("日程服务已初始化")
    }

    private registerDatabaseModel() {
        this.ctx.model.extend('yesimbot.daily_schedules', {
            date: 'string(10)',
            segments: 'json',
            memoryContext: 'list',
        }, {
            primary: 'date',
        });
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
            return blocks.filter(b => this.config.coreMemoryLabel.includes(b.label));
        } catch {
            return [];
        }
    }

    private buildSchedulePrompt(coreMemories: MemoryBlockData[], recentEvents: any[]): string {
        let prompt = `你是一个小说家，请基于以下信息为虚拟人物${this.config.characterName}规划今日日程：\n\n`;

        // 添加核心记忆
        prompt += `## ${this.config.characterName}的核心记忆:\n`;
        coreMemories.forEach((memory, i) => {
            prompt += `${i + 1}. ${memory.title}: ${truncate(memory.content.join(" "), 200)}\n`;
        });

        // 添加近期事件
        if (recentEvents.length) {
            prompt += "\n## 近期事件:\n";
            recentEvents.forEach((event, i) => {
                prompt += `${i + 1}. ${event.toString()}\n`;
            });
        }

        // 添加时间分段和格式要求
        prompt += `\n## 时间分段:\n请按以下时间段规划日程: ${this.config.timeSegments.join(", ")}\n`;
        prompt += "## 输出格式要求:\n";
        prompt += "请严格按照以下JSON格式返回日程安排：\n";
        prompt += `{\n  "schedule": {\n    "${this.config.timeSegments[0]}": "内容1",\n    "${this.config.timeSegments[1]}": "内容2",\n    ...\n  }\n}\n\n`;
        prompt += "注意：必须包含所有时间段！每个时间段用1-2句话描述主要活动，使用自然语言。这个日程是主人公日常生活的日程，你需要根据他的核心记忆来虚构。你要把他当人类来看待。请注意，这只是计划，还没有正式开始，不是写日记。";

        this.logger.debug("生成的提示词:", prompt);
        return prompt;
    }


    private parseScheduleOutput(text: string): Record<string, string> {
        this.logger.debug("解析日程文本:", text);

        try {
            // 尝试提取JSON部分
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1) {
                throw new Error("未找到JSON结构");
            }

            const jsonStr = text.slice(jsonStart, jsonEnd + 1);
            this.logger.debug("提取的JSON字符串:", jsonStr);

            const parsed = JSON.parse(jsonStr);
            if (!parsed.schedule || typeof parsed.schedule !== 'object') {
                throw new Error("JSON中缺少schedule字段");
            }

            const schedule = parsed.schedule;
            // 检查是否包含所有时间段
            for (const segment of this.config.timeSegments) {
                if (!(segment in schedule)) {
                    throw new Error(`JSON中缺少时间段: ${segment}`);
                }
            }

            return schedule;
        } catch (error) {
            this.logger.error("JSON解析失败:", error.message);
            return this.fallbackParse(text);
        }
    }

    private fallbackParse(text: string): Record<string, string> {
        this.logger.warn("使用备用解析方法");
        const segments: Record<string, string> = {};

        // 1. 尝试按指定格式解析
        const lines = text.split('\n');
        for (const line of lines) {
            for (const segment of this.config.timeSegments) {
                // 匹配格式: "时间段: 内容"
                const regex = new RegExp(`^${segment}\\s*[:：]\\s*(.+)`);
                const match = line.match(regex);

                if (match) {
                    segments[segment] = match[1].trim();
                    break;
                }
            }
        }

        // 2. 如果部分解析成功，填充缺失的时间段
        if (Object.keys(segments).length > 0) {
            for (const segment of this.config.timeSegments) {
                if (!segments[segment]) {
                    segments[segment] = "处理用户请求和系统任务";
                }
            }
            return segments;
        }

        // 3. 回退到关键词匹配
        for (const segment of this.config.timeSegments) {
            const regex = new RegExp(`${segment}[^\\n]+`, 'i');
            const match = text.match(regex);
            if (match) {
                // 提取内容部分（去掉时间段名称）
                const content = match[0].replace(new RegExp(`${segment}\\s*[:：]?\\s*`, 'i'), '').trim();
                segments[segment] = content;
            }
        }

        // 4. 如果仍然无法解析，使用默认分配
        if (Object.keys(segments).length === 0) {
            this.logger.warn("无法解析日程，使用默认值");
            this.config.timeSegments.forEach(segment => {
                segments[segment] = "处理用户请求和系统任务";
            });
        }

        return segments;
    }

    private async generateWithModel(prompt: string): Promise<string> {
        if (!this.chatModel) {
            throw new Error("日程生成模型不可用");
        }

        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount <= maxRetries) {
            try {
                const response = await this.chatModel.chat({
                    messages: [{
                        role: "system",
                        content: `你是一个专业的日程规划助手，请根据提供的信息为${this.config.characterName}创建合理的日程安排。必须使用指定的JSON格式！`
                    }, {
                        role: "user",
                        content: prompt
                    }],
                    temperature: 0.3
                });

                this.logger.debug("模型原始响应:", response.text);

                // 验证响应是否为JSON格式
                try {
                    const jsonStart = response.text.indexOf('{');
                    const jsonEnd = response.text.lastIndexOf('}');
                    if (jsonStart === -1 || jsonEnd === -1) {
                        throw new Error("响应中未找到JSON");
                    }

                    const jsonStr = response.text.slice(jsonStart, jsonEnd + 1);
                    JSON.parse(jsonStr); // 验证是否能解析
                    return response.text;
                } catch (error) {
                    this.logger.warn("响应不是有效的JSON，将重试");
                    retryCount++;
                    continue;
                }
            } catch (error) {
                this.logger.error("模型调用失败:", error);
                retryCount++;
            }
        }

        throw new Error("日程生成失败，重试次数用尽");
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