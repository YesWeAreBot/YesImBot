import type { Context } from "koishi";
import type { IChatModel, MemoryBlockData, MemoryService } from "koishi-plugin-yesimbot/services";
import type { DailyPlannerConfig } from ".";
import { Services } from "koishi-plugin-yesimbot/shared";

// 时间段接口
interface TimeSegment {
    start: string; // HH:mm 格式
    end: string; // HH:mm 格式
    content: string;
}

// 日程数据结构
export interface DailySchedule {
    date: string; // YYYY-MM-DD
    segments: TimeSegment[]; // 时间段数组
    memoryContext?: string[]; // 关联的记忆ID
}

declare module "koishi" {
    interface Tables {
        "yesimbot.daily_schedules": DailySchedule;
    }
}

export class DailyPlannerService {
    private readonly memoryService: MemoryService;
    private readonly chatModel: IChatModel;

    constructor(
        private ctx: Context,
        private config: DailyPlannerConfig,
    ) {
        this.memoryService = ctx[Services.Memory];
        this.chatModel = ctx[Services.Model].getChatModel(this.config.model.providerName, config.model.modelId);
        this.registerDatabaseModel();
        this.registerPromptSnippet();
        this.ctx.logger.info("日程服务已初始化");
    }

    private registerDatabaseModel() {
        this.ctx.model.extend(
            "yesimbot.daily_schedules",
            {
                date: "string(10)",
                segments: "json",
                memoryContext: "list",
            },
            {
                primary: "date",
            },
        );
    }

    private registerPromptSnippet() {
        const promptService = this.ctx[Services.Prompt];
        if (!promptService)
            return;

        // 注册当前日程动态片段
        promptService.registerSnippet("agent.context.currentSchedule", async () => {
            const currentSegment = await this.getCurrentTimeSegment();
            return currentSegment
                ? `${currentSegment.start}-${currentSegment.end}: ${currentSegment.content}`
                : "当前没有特别安排（自由时间）";
        });

        // 注册今日日程概览
        promptService.registerSnippet("agent.context.dailySchedule", async () => {
            const schedule = await this.getTodaysSchedule();
            return schedule.segments.map((s) => `${s.start}-${s.end}: ${s.content}`).join("\n");
        });
    }

    // 生成今日日程
    public async generateDailySchedule(): Promise<DailySchedule> {
        const today = new Date().toISOString().split("T")[0];

        // 1. 获取核心记忆和近期事件
        const coreMemories = await this.getCoreMemories();

        // const recentEvents = await this.ctx[Services.WorldState].l2_manager.search("我");
        const recentEvents = [];

        // 2. 构建提示词
        const prompt = this.buildSchedulePrompt(
            coreMemories,
            recentEvents.map((e) => e.content),
        );

        // 3. 调用模型生成日程
        const generatedSchedule = await this.generateWithModel(prompt);

        // 4. 解析并存储日程
        const parsedSchedule = this.parseScheduleOutput(generatedSchedule);
        const fullSchedule: DailySchedule = {
            date: today,
            segments: parsedSchedule,
            memoryContext: [...coreMemories.map((m) => m.label), ...recentEvents.map((e) => e.id)],
        };

        await this.saveSchedule(fullSchedule);
        return fullSchedule;
    }

    // 获取今日日程
    public async getTodaysSchedule(): Promise<DailySchedule> {
        const today = new Date().toISOString().split("T")[0];
        const schedule = await this.ctx.database.get("yesimbot.daily_schedules", { date: today });

        if (!schedule.length) {
            this.ctx.logger.info("今日日程未生成，正在创建...");
            return this.generateDailySchedule();
        }
        return schedule[0];
    }

    // 获取当前时间段
    public async getCurrentTimeSegment(): Promise<TimeSegment | null> {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, "0");
        const minutes = now.getMinutes().toString().padStart(2, "0");
        const currentTime = `${hours}:${minutes}`;

        // 找到当前时间所在的时间段
        try {
            const schedule = await this.getTodaysSchedule();
            for (const segment of schedule.segments) {
                if (this.compareTime(currentTime, segment.start) >= 0 && this.compareTime(currentTime, segment.end) < 0) {
                    return segment;
                }
            }
            return null;
        } catch (error: any) {
            this.ctx.logger.error("获取当前时间段失败", error);
            return null;
        }
    }

    // --- 私有方法 ---

    private async getCoreMemories(): Promise<MemoryBlockData[]> {
        try {
            const blocks = await this.memoryService.getMemoryBlocksForRendering();
            return blocks.filter((b) => this.config.coreMemoryLabel.includes(b.label));
        } catch {
            return [];
        }
    }

    public async overrideCurrentSchedule(content: string, duration: number) {
        const schedule = await this.getTodaysSchedule();
        const now = new Date();
        const end = new Date(now.getTime() + duration * 60000);

        const currentSegment = {
            start: formatTime(now),
            end: formatTime(end),
            content,
        };

        // 添加到今日日程
        schedule.segments.unshift(currentSegment);
        await this.saveSchedule(schedule);
    }

    public async addCustomTimeSegment(start: string, end: string, content: string) {
        const schedule = await this.getTodaysSchedule();
        schedule.segments.push({ start, end, content });
        await this.saveSchedule(schedule);
    }

    public async removeTimeSegment(index: number) {
        const schedule = await this.getTodaysSchedule();
        if (index >= 0 && index < schedule.segments.length) {
            schedule.segments.splice(index, 1);
            await this.saveSchedule(schedule);
        }
    }

    private buildSchedulePrompt(coreMemories: MemoryBlockData[], recentEvents: any[]): string {
        let prompt = `你是一个专业的生活规划师，请基于以下信息为${this.config.characterName}规划今天的详细日程安排：\n\n`;

        // 添加核心记忆
        prompt += `## ${this.config.characterName}的核心记忆:\n`;
        coreMemories.forEach((memory, i) => {
            prompt += `${i + 1}. ${memory.title}: ${truncate(memory.content, 200)}\n`;
        });

        // 添加近期事件
        if (recentEvents.length) {
            prompt += "\n## 近期事件:\n";
            recentEvents.forEach((event, i) => {
                prompt += `${i + 1}. ${event.toString()}\n`;
            });
        }

        // 添加时间要求
        prompt += `\n## 日程规划要求:\n`;
        prompt += "1. 将一天划分为6-10个时间段，每个时间段应有明确的开始和结束时间（HH:mm格式）\n";
        prompt += "2. 每个时间段安排1-2个主要活动，活动内容应具体且有可执行性\n";
        prompt += "3. 合理安排休息时间，避免长时间连续工作\n";
        prompt += `4. 考虑${this.config.characterName}的习惯和偏好，让日程更人性化\n`;
        prompt += "5. 预留一定的缓冲时间应对突发事件\n\n";

        prompt += "## 输出格式要求:\n";
        prompt += "请严格按照以下JSON格式返回日程安排：\n";
        prompt += `[\n`;
        prompt += `  {\n`;
        prompt += `    "start": "08:00",\n`;
        prompt += `    "end": "09:00",\n`;
        prompt += `    "content": "日程1"\n`;
        prompt += `  },\n`;
        prompt += `  {\n`;
        prompt += `    "start": "09:00",\n`;
        prompt += `    "end": "12:00",\n`;
        prompt += `    "content": "日程2"\n`;
        prompt += `  },\n`;
        prompt += `  ...\n`;
        prompt += `]\n\n`;
        prompt += "注意：时间段之间不应有重叠，每个时间段的活动描述应清晰具体，避免模糊描述。";

        this.ctx.logger.debug("生成的提示词:", prompt);
        return prompt;
    }

    private parseScheduleOutput(text: string): TimeSegment[] {
        this.ctx.logger.debug("解析日程文本:", text);

        try {
            // 尝试提取JSON部分
            const jsonStart = text.indexOf("[");
            const jsonEnd = text.lastIndexOf("]");
            if (jsonStart === -1 || jsonEnd === -1) {
                throw new Error("未找到JSON数组结构");
            }

            const jsonStr = text.slice(jsonStart, jsonEnd + 1);
            this.ctx.logger.debug("提取的JSON字符串:", jsonStr);

            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed)) {
                throw new TypeError("JSON中缺少数组");
            }

            // 验证每个时间段
            const segments: TimeSegment[] = [];
            for (const item of parsed) {
                if (!item.start || !item.end || !item.content) {
                    throw new Error("时间段缺少必要字段");
                }

                // 验证时间格式
                if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(item.start) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(item.end)) {
                    throw new Error(`无效的时间格式: ${item.start} 或 ${item.end}`);
                }

                segments.push({
                    start: item.start,
                    end: item.end,
                    content: item.content,
                });
            }

            // 按开始时间排序
            segments.sort((a, b) => this.compareTime(a.start, b.start));

            // 验证时间段是否有重叠
            for (let i = 0; i < segments.length - 1; i++) {
                if (this.compareTime(segments[i].end, segments[i + 1].start) > 0) {
                    throw new Error(`时间段重叠: ${segments[i].end} > ${segments[i + 1].start}`);
                }
            }

            return segments;
        } catch (error: any) {
            this.ctx.logger.error("JSON解析失败:", error.message);
            return this.fallbackParse(text);
        }
    }

    private fallbackParse(text: string): TimeSegment[] {
        this.ctx.logger.warn("使用备用解析方法");
        const segments: TimeSegment[] = [];

        // 尝试匹配时间模式：HH:mm-HH:mm 内容
        const timeRegex = /(\d{1,2}:\d{2})\s*(?:[-—]\s*)?(\d{1,2}:\d{2})\s*(?:[:：]\s*)?(.+)/g;
        let match;

        while ((match = timeRegex.exec(text)) !== null) {
            segments.push({
                start: match[1],
                end: match[2],
                content: match[3].trim(),
            });
        }

        // 如果找到了时间段，返回它们
        if (segments.length > 0) {
            // 按开始时间排序
            segments.sort((a, b) => this.compareTime(a.start, b.start));
            return segments;
        }

        // 尝试匹配仅包含时间的行
        const simpleTimeRegex = /(\d{1,2}:\d{2})\s*(?:[-—]\s*)?(\d{1,2}:\d{2})/g;
        const contentLines = text.split("\n");
        let currentContent = "";

        for (let i = 0; i < contentLines.length; i++) {
            const line = contentLines[i].trim();

            // 检查是否是时间行
            const timeMatch = simpleTimeRegex.exec(line);
            if (timeMatch) {
                // 如果已有内容，添加到上一个时间段
                if (currentContent) {
                    if (segments.length > 0) {
                        segments[segments.length - 1].content += currentContent;
                    }
                    currentContent = "";
                }

                // 创建新时间段
                segments.push({
                    start: timeMatch[1],
                    end: timeMatch[2],
                    content: "",
                });
            } else if (line && segments.length > 0) {
                // 添加到当前时间段的内容
                segments[segments.length - 1].content += (segments[segments.length - 1].content ? " " : "") + line;
            }
        }

        // 处理最后一个时间段的内容
        if (segments.length > 0 && currentContent) {
            segments[segments.length - 1].content += currentContent;
        }

        // 如果仍然无法解析，使用默认分配
        if (segments.length === 0) {
            this.ctx.logger.warn("无法解析日程，使用默认值");
            return [
                { start: "08:00", end: "12:00", content: "处理用户请求和系统任务" },
                { start: "12:00", end: "13:00", content: "午餐与休息" },
                { start: "13:00", end: "18:00", content: "继续处理用户请求和系统任务" },
                { start: "18:00", end: "19:00", content: "晚餐时间" },
                { start: "19:00", end: "22:00", content: "个人学习与发展时间" },
            ];
        }

        return segments;
    }

    // 比较两个时间字符串 (HH:mm)
    private compareTime(timeA: string, timeB: string): number {
        const [hoursA, minutesA] = timeA.split(":").map(Number);
        const [hoursB, minutesB] = timeB.split(":").map(Number);

        if (hoursA !== hoursB) {
            return hoursA - hoursB;
        }
        return minutesA - minutesB;
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
                    messages: [
                        {
                            role: "system",
                            content: `你是一个专业的日程规划助手，请根据提供的信息为${this.config.characterName}创建合理的日程安排。必须使用指定的JSON格式！`,
                        },
                        {
                            role: "user",
                            content: prompt,
                        },
                    ],
                    temperature: 0.3,
                });

                this.ctx.logger.debug("模型原始响应:", response.text);

                // 验证响应是否为JSON数组格式
                try {
                    const jsonStart = response.text.indexOf("[");
                    const jsonEnd = response.text.lastIndexOf("]");
                    if (jsonStart === -1 || jsonEnd === -1) {
                        throw new Error("响应中未找到JSON数组");
                    }

                    const jsonStr = response.text.slice(jsonStart, jsonEnd + 1);
                    JSON.parse(jsonStr); // 验证是否能解析
                    return response.text;
                } catch (error: any) {
                    this.ctx.logger.warn("响应不是有效的JSON数组，将重试");
                    retryCount++;
                    continue;
                }
            } catch (error: any) {
                this.ctx.logger.error("模型调用失败:", error);
                retryCount++;
            }
        }

        throw new Error("日程生成失败，重试次数用尽");
    }

    private async saveSchedule(schedule: DailySchedule): Promise<void> {
        await this.ctx.database.upsert("yesimbot.daily_schedules", [schedule], ["date"]);
    }
}

// 辅助函数
function truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatDate(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
// 辅助函数：格式化时间
function formatTime(date: Date): string {
    return date.toTimeString().slice(0, 5);
}
