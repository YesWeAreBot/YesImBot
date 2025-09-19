import { Context, h, Logger } from "koishi";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { Services, TableName } from "@/shared/constants";
import { HistoryConfig } from "./config";
import {
    AgentActionLog,
    AgentHeartbeatLog,
    AgentLogEntry,
    AgentObservationLog,
    AgentThoughtLog,
    L1HistoryItem,
    MessageData,
    SystemEventData,
} from "./types";

/**
 * L1 工作记忆管理器 (混合模式)
 * 负责将核心事件（消息、系统事件）持久化到数据库，
 * 将高频的 Agent 内部事件（思考、动作、观察）记录到本地文件系统，
 * 并提供统一的方法来检索和组合这些来源的数据，以构建线性的历史记录。
 */
export class InteractionManager {
    private logger: Logger;
    private basePath: string;

    constructor(
        private ctx: Context,
        private config: HistoryConfig
    ) {
        this.logger = ctx[Services.Logger].getLogger("[L1 记忆]");
        this.basePath = path.join(ctx.baseDir, "data", "yesimbot", "interactions");
        this.ensureDirExists(this.basePath);
    }

    // --- 文件日志系统 ---

    private getLogFilePath(platform: string, channelId: string): string {
        // 移除特殊字符
        function clear(str: string) {
            return str.replace(/[:/\\]/g, "_");
        }
        return path.join(this.basePath, clear(platform), `${clear(channelId)}.agent.jsonl`);
    }

    private async ensureDirExists(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            this.logger.error(`创建日志目录失败: ${dirPath}`, error);
        }
    }

    private async appendToLog(platform: string, channelId: string, entry: AgentLogEntry): Promise<void> {
        const filePath = this.getLogFilePath(platform, channelId);
        await this.ensureDirExists(path.dirname(filePath));
        const line = JSON.stringify(entry) + "\n";
        try {
            await fs.appendFile(filePath, line);
        } catch (error) {
            this.logger.error(`写入Agent日志失败 | 文件: ${filePath} | ID: ${entry.id}`);
            this.logger.debug(error);
        }
    }

    public async recordThought(turnId: string, platform: string, channelId: string, thoughts: AgentThoughtLog["thoughts"]): Promise<void> {
        const logEntry: AgentThoughtLog = {
            type: "agent_thought",
            id: uuidv4(),
            turnId,
            timestamp: new Date().toISOString(),
            thoughts,
        };
        await this.appendToLog(platform, channelId, logEntry);
    }

    public async recordAction(
        turnId: string,
        platform: string,
        channelId: string,
        action: { function: string; params: Record<string, unknown> }
    ): Promise<string> {
        const actionId = uuidv4();
        const logEntry: AgentActionLog = {
            type: "agent_action",
            id: actionId,
            turnId,
            timestamp: new Date().toISOString(),
            function: action.function,
            params: action.params,
        };
        await this.appendToLog(platform, channelId, logEntry);
        return actionId;
    }

    public async recordObservation(
        actionId: string,
        platform: string,
        channelId: string,
        observation: Omit<AgentObservationLog, "id" | "type" | "actionId" | "timestamp">
    ): Promise<void> {
        const logEntry: AgentObservationLog = {
            type: "agent_observation",
            id: uuidv4(),
            actionId,
            timestamp: new Date().toISOString(),
            ...observation,
        };
        await this.appendToLog(platform, channelId, logEntry);
    }

    public async recordHeartbeat(turnId: string, platform: string, channelId: string, current: number, max: number) {
        const logEntry: AgentHeartbeatLog = {
            type: "agent_heartbeat",
            id: uuidv4(),
            turnId,
            timestamp: new Date().toISOString(),
            current,
            max,
        };
        await this.appendToLog(platform, channelId, logEntry);
    }

    private async getAgentHistoryFromFile(platform: string, channelId: string, limit: number): Promise<L1HistoryItem[]> {
        const filePath = this.getLogFilePath(platform, channelId);
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n").filter(Boolean);
            const recentLines = lines.slice(-limit);
            return recentLines.map((line) => this.logEntryToHistoryItem(JSON.parse(line)));
        } catch (error) {
            if (error.code === "ENOENT") return [];
            this.logger.error(`读取Agent日志失败: ${filePath}`, error);
            return [];
        }
    }

    // --- 数据库系统 ---

    public async recordMessage(message: MessageData): Promise<void> {
        try {
            await this.ctx.database.create(TableName.Messages, message);
        } catch (error) {
            if (error?.message === "UNIQUE constraint failed: worldstate.messages.id") {
                this.logger.warn(`存在重复的消息记录: ${message.id} | 若此问题持续发生，考虑开启忽略自身消息`);
                return;
            }
            this.logger.error(`记录消息到数据库失败 | 消息ID: ${message.id} | Error: ${error.message}`);
            this.logger.debug(error);
        }
    }

    public async recordSystemEvent(event: SystemEventData): Promise<void> {
        try {
            await this.ctx.database.create(TableName.SystemEvents, event);
            this.logger.debug(`记录系统事件 | ${event.type} | ${event.message}`);
        } catch (error) {
            this.logger.error(`记录系统事件到数据库失败 | ID: ${event.id}`);
            this.logger.debug(error);
        }
    }

    // --- 统一历史记录检索 ---

    /**
     * 获取指定频道的 L1 线性历史记录。
     * @param channelId 频道 ID
     * @param limit 检索的事件数量上限
     * @returns 按时间升序排列的事件数组
     */
    public async getL1History(platform: string, channelId: string, limit: number): Promise<L1HistoryItem[]> {
        const [messages, systemEvents, agentEvents] = await Promise.all([
            this.ctx.database.get(TableName.Messages, { channelId }, { limit, sort: { timestamp: "desc" } }),
            this.ctx.database.get(TableName.SystemEvents, { channelId }, { limit, sort: { timestamp: "desc" } }),
            this.getAgentHistoryFromFile(platform, channelId, limit),
        ]);

        const combinedEvents: L1HistoryItem[] = [
            ...messages.map(
                (m): L1HistoryItem => ({
                    type: "message",
                    id: m.id,
                    sender: m.sender,
                    content: m.content,
                    elements: h.parse(m.content),
                    timestamp: m.timestamp,
                    quoteId: m.quoteId,
                })
            ),
            ...systemEvents.map(
                (s): L1HistoryItem => ({
                    type: "system_event",
                    id: s.id,
                    eventType: s.type,
                    message: s.message,
                    timestamp: s.timestamp,
                })
            ),
            ...agentEvents,
        ];

        combinedEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return combinedEvents.slice(-limit);
    }

    private logEntryToHistoryItem(entry: AgentLogEntry): L1HistoryItem {
        const timestamp = new Date(entry.timestamp);
        switch (entry.type) {
            case "agent_thought":
                return {
                    type: "agent_thought",
                    turnId: entry.turnId,
                    timestamp,
                    observe: entry.thoughts.observe,
                    analyze_infer: entry.thoughts.analyze_infer,
                    plan: entry.thoughts.plan,
                };
            case "agent_action":
                return {
                    type: "agent_action",
                    turnId: entry.turnId,
                    timestamp,
                    function: entry.function,
                    params: entry.params,
                };
            case "agent_observation":
                return {
                    type: "agent_observation",
                    turnId: entry.turnId,
                    timestamp,
                    function: entry.function,
                    status: entry.status,
                    result: entry.result,
                };
            case "agent_heartbeat":
                return {
                    type: "agent_heartbeat",
                    turnId: entry.turnId,
                    timestamp,
                    current: entry.current,
                    max: entry.max,
                };
            default:
                return null;
        }
    }

    public async pruneOldData(): Promise<void> {
        for (const dir of await fs.readdir(this.basePath)) {
            const dirPath = path.join(this.basePath, dir);
            const stat = await fs.stat(dirPath);
            if (!stat.isDirectory()) continue;

            for (const file of await fs.readdir(dirPath)) {
                const filePath = path.join(dirPath, file);
                try {
                    const content = await fs.readFile(filePath, "utf-8");
                    const lines = content.trim().split("\n").filter(Boolean);
                    const linesToKeep = this.config.logLengthLimit ? lines.slice(-this.config.logLengthLimit) : lines;

                    await fs.writeFile(filePath, linesToKeep.join("\n") + "\n");
                } catch (error) {
                    this.logger.error(`清理日志文件失败: ${filePath}`, error);
                }
            }
        }
    }

    public async clearAgentHistory(platform?: string, channelId?: string): Promise<void> {
        let targetPath: string;
        let targetType: "file" | "dir" = "dir";
        if (!platform && !channelId) {
            // 删除所有记录
            targetPath = this.basePath;
        } else if (platform && !channelId) {
            // 删除整个平台的记录
            targetPath = path.join(this.basePath, platform);
        } else if (platform && channelId) {
            // 删除具体频道的记录文件
            targetPath = this.getLogFilePath(platform, channelId);
            targetType = "file";
        } else {
            throw new Error("必须同时指定 platform 和 channelId");
        }
        try {
            await fs.rm(targetPath, { recursive: true, force: true });
            this.logger.info(`已删除Agent日志${targetType === "dir" ? "目录" : "文件"}: ${targetPath}`);
        } catch (error: any) {
            // force: true 已经避免 ENOENT 报错，这里主要处理其他异常
            this.logger.error(`删除Agent日志${targetType === "dir" ? "目录" : "文件"}失败: ${targetPath}`, error);
            throw error;
        }
    }

    public async getAgentHistoryForDateRange(
        platform: string,
        channelId: string,
        startDate: Date,
        endDate: Date
    ): Promise<AgentLogEntry[]> {
        const filePath = this.getLogFilePath(platform, channelId);
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            const entries: AgentLogEntry[] = [];
            for (const line of lines) {
                if (!line) continue;
                const entry = JSON.parse(line) as AgentLogEntry;
                const entryDate = new Date(entry.timestamp);
                if (entryDate >= startDate && entryDate < endDate) {
                    entries.push(entry);
                }
            }
            return entries;
        } catch (error) {
            if (error.code === "ENOENT") return [];
            this.logger.error(`读取Agent日志失败: ${filePath}`, error);
            return [];
        }
    }
}
