import { Context, h, Logger } from "koishi";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { Services, TableName } from "@/shared/constants";
import { HISTORY_CHANNELS } from "./channel-metadata";
import { HistoryConfig } from "./config";
import {
    AgentActionLog,
    AgentHeartbeatLog,
    AgentLogEntry,
    AgentObservationLog,
    AgentThoughtLog,
    InteractionLogEntry,
    L1HistoryItem,
    MessageData,
    SystemEventData,
} from "./types";

const logMutations = new Map<string, Promise<void>>();

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

    private canIdentifyLegacyLogOwner(filePath: string, channelId?: string, channelType?: "private" | "guild" | "all"): boolean {
        const legacyId = path.basename(filePath, ".agent.jsonl");
        // 下划线可能来自原始冒号、斜线或下划线，平台目录和频道名都不能据此猜测归属。
        return !path.basename(path.dirname(filePath)).includes("_") &&
            (!channelId || !legacyId.includes("_")) &&
            (!channelType || channelType === "all");
    }

    private async ensureDirExists(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            this.logger.error(`创建日志目录失败: ${dirPath}`, error);
        }
    }

    private async mutateLogs<T>(operation: () => Promise<T>): Promise<T> {
        // 追加、截断和清理共享同一屏障，避免重写覆盖刚追加的记录。
        const result = (logMutations.get(this.basePath) || Promise.resolve()).then(operation);
        const settled = result.then(() => undefined, () => undefined);
        logMutations.set(this.basePath, settled);
        try {
            return await result;
        } finally {
            if (logMutations.get(this.basePath) === settled) logMutations.delete(this.basePath);
        }
    }

    private async appendToLog(platform: string, channelId: string, entry: AgentLogEntry): Promise<void> {
        await this.mutateLogs(async () => {
            const filePath = this.getLogFilePath(platform, channelId);
            await this.ensureDirExists(path.dirname(filePath));
            const [channel] = await this.ctx.database.get(HISTORY_CHANNELS, { platform, channelId });
            const line = JSON.stringify({ ...entry, platform, channelId, channelType: channel?.channelType || undefined }) + "\n";
            try {
                await fs.appendFile(filePath, line);
            } catch (error) {
                this.logger.error(`写入Agent日志失败 | 文件: ${filePath} | ID: ${entry.id}`);
                this.logger.debug(error);
            }
        });
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
            const legacyAllowed = this.canIdentifyLegacyLogOwner(filePath, channelId);
            const history: L1HistoryItem[] = [];
            for (const line of content.split("\n")) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line) as InteractionLogEntry & { platform?: unknown; channelId?: unknown };
                    if (!entry || typeof entry !== "object") continue;
                    if (typeof entry.platform === "string" && entry.platform !== platform) continue;
                    if (typeof entry.channelId === "string" && entry.channelId !== channelId) continue;
                    if ((typeof entry.platform !== "string" || typeof entry.channelId !== "string") && !legacyAllowed) continue;
                    const item = this.logEntryToHistoryItem(entry);
                    if (item && Number.isFinite(item.timestamp.getTime())) history.push(item);
                } catch {
                    // 坏行不应使同一文件中的有效记录全部丢失。
                }
            }
            return history.slice(-limit);
        } catch (error) {
            if (error.code === "ENOENT") return [];
            this.logger.error(`读取Agent日志失败: ${filePath}`, error);
            return [];
        }
    }

    // --- 数据库系统 ---

    public async recordMessage(message: MessageData): Promise<void> {
        try {
            if (message.channelType) await this.ctx.database.upsert(HISTORY_CHANNELS, [{
                platform: message.platform, channelId: message.channelId, channelType: message.channelType,
            }]);
            await this.ctx.database.create(TableName.Messages, message);
        } catch (error) {
            if (error?.code === "duplicate-entry" || /^UNIQUE constraint failed: worldstate\.messages\./.test(error?.message || "")) {
                this.logger.warn(`存在重复的消息记录: ${message.id} | 若此问题持续发生，考虑开启忽略自身消息`);
                return;
            }
            this.logger.error(`记录消息到数据库失败 | 消息ID: ${message.id} | Error: ${error.message}`);
            this.logger.debug(error);
        }
    }

    public async recordSystemEvent(event: SystemEventData): Promise<void> {
        try {
            if (event.channelType) await this.ctx.database.upsert(HISTORY_CHANNELS, [{
                platform: event.platform, channelId: event.channelId, channelType: event.channelType,
            }]);
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
            this.ctx.database.get(TableName.Messages, { platform, channelId }, { limit, sort: { timestamp: "desc" } }),
            this.ctx.database.get(TableName.SystemEvents, { platform, channelId }, { limit, sort: { timestamp: "desc" } }),
            this.getAgentHistoryFromFile(platform, channelId, limit),
        ]);

        const combinedEvents: L1HistoryItem[] = [
            ...messages.map((m): L1HistoryItem => ({
                type: "message",
                id: m.id,
                sender: m.sender,
                content: m.content,
                elements: h.parse(m.content),
                timestamp: m.timestamp,
                quoteId: m.quoteId,
            })),
            ...systemEvents.map((s): L1HistoryItem => ({
                type: "system_event",
                id: s.id,
                eventType: s.type,
                message: s.message,
                timestamp: s.timestamp,
            })),
            ...agentEvents,
        ];

        combinedEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return combinedEvents.slice(-limit);
    }

    private logEntryToHistoryItem(entry: InteractionLogEntry): L1HistoryItem {
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
            // 下面的 case 理论上不会被这个私有方法调用，因为消息和系统事件直接从数据库转换
            case "message":
            case "system_event":
                // This path should not be taken in the new flow
                return null;
        }
    }

    public async pruneOldData(): Promise<void> {
        await this.mutateLogs(async () => {
            let directories: string[];
            try { directories = await fs.readdir(this.basePath); } catch (error) {
                if (error.code === "ENOENT") return;
                throw error;
            }
            for (const dir of directories) {
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
        });
    }

    public async clearAgentHistory(platform?: string, channelId?: string, channelType?: "private" | "guild" | "all"): Promise<number> {
        if (channelType !== undefined && !["private", "guild", "all"].includes(channelType)) {
            throw new Error("频道类型必须是 private、guild 或 all");
        }
        if (channelId && !platform) throw new Error("必须同时指定 platform 和 channelId");
        return this.mutateLogs(async () => {
            if (!platform && !channelId && (!channelType || channelType === "all")) {
                await fs.rm(this.basePath, { recursive: true, force: true });
                return 0;
            }
            let directories: string[];
            try {
                directories = platform
                    ? [path.dirname(this.getLogFilePath(platform, ""))]
                    : (await fs.readdir(this.basePath, { withFileTypes: true }))
                          .filter(entry => entry.isDirectory())
                          .map(entry => path.join(this.basePath, entry.name));
            } catch (error) {
                if (error.code === "ENOENT") return 0;
                throw error;
            }
            const channelTypes = new Map<string, string>();
            if (channelType && channelType !== "all") {
                for (const channel of await this.ctx.database.get(HISTORY_CHANNELS, {})) {
                    if (channel.channelType) channelTypes.set(JSON.stringify([channel.platform, channel.channelId]), channel.channelType);
                }
            }
            let preserved = 0;
            for (const directory of directories) {
                let files;
                try {
                    files = await fs.readdir(directory, { withFileTypes: true });
                } catch (error) {
                    if (error.code === "ENOENT") continue;
                    throw error;
                }
                for (const file of files) {
                    if (!file.isFile() || !file.name.endsWith(".agent.jsonl")) continue;
                    const filePath = path.join(directory, file.name);
                    if (channelId && filePath !== this.getLogFilePath(platform!, channelId)) continue;
                    const legacyAllowed = this.canIdentifyLegacyLogOwner(filePath, channelId, channelType);
                    let content: string;
                    try {
                        content = await fs.readFile(filePath, "utf8");
                    } catch (error) {
                        if (error.code === "ENOENT") continue;
                        throw error;
                    }
                    let unknown = 0;
                    const keep = content.split(/(?<=\n)/).filter(line => {
                        if (!line.trim()) return true;
                        let entry: { platform?: unknown; channelId?: unknown; channelType?: unknown } = {};
                        try { entry = JSON.parse(line) || {}; } catch { /* 无法解析的旧记录沿用同一归属保护。 */ }
                        if (typeof entry.platform === "string" && platform && entry.platform !== platform) return true;
                        if (typeof entry.channelId === "string" && channelId && entry.channelId !== channelId) return true;
                        if (typeof entry.platform !== "string" || typeof entry.channelId !== "string") {
                            if (!legacyAllowed) unknown++;
                            return !legacyAllowed;
                        }
                        const knownType = entry.channelType === "private" || entry.channelType === "guild"
                            ? entry.channelType : channelTypes.get(JSON.stringify([entry.platform, entry.channelId]));
                        if (channelType && channelType !== "all" && !knownType) unknown++;
                        return !((!platform || entry.platform === platform) &&
                            (!channelId || entry.channelId === channelId) &&
                            (!channelType || channelType === "all" || knownType === channelType));
                    }).join("");
                    if (unknown) {
                        preserved += unknown;
                        this.logger.warn(`旧Agent日志归属不明，保留 ${unknown} 条记录: ${filePath}`);
                    }
                    if (keep === content) continue;
                    if (!keep.trim()) {
                        await fs.rm(filePath, { force: true });
                    } else {
                        const temporary = `${filePath}.${uuidv4()}.tmp`;
                        try {
                            await fs.writeFile(temporary, keep);
                            await fs.rename(temporary, filePath);
                        } finally {
                            await fs.rm(temporary, { force: true });
                        }
                    }
                }
            }
            this.logger.info("已清理指定范围的Agent日志");
            return preserved;
        });
    }

    public async getAgentChannels(knownChannels: { platform: string; channelId: string }[] = []): Promise<{ platform: string; channelId: string }[]> {
        const channels = new Map<string, { platform: string; channelId: string }>();
        let directories;
        try {
            directories = await fs.readdir(this.basePath, { withFileTypes: true });
        } catch (error) {
            if (error.code === "ENOENT") return [];
            throw error;
        }
        const add = (channel: { platform: string; channelId: string }) => channels.set(JSON.stringify([channel.platform, channel.channelId]), channel);
        for (const directory of directories) {
            if (!directory.isDirectory()) continue;
            const directoryPath = path.join(this.basePath, directory.name);
            let files;
            try {
                files = await fs.readdir(directoryPath, { withFileTypes: true });
            } catch (error) {
                if (error.code === "ENOENT") continue;
                throw error;
            }
            for (const file of files) {
                if (!file.isFile() || !file.name.endsWith(".agent.jsonl")) continue;
                const filePath = path.join(directoryPath, file.name);
                let content: string;
                try {
                    content = await fs.readFile(filePath, "utf-8");
                } catch (error) {
                    if (error.code === "ENOENT") continue;
                    throw error;
                }
                let identified = false;
                for (const line of content.split("\n")) {
                    try {
                        const entry = JSON.parse(line) as AgentLogEntry;
                        if (typeof entry.platform !== "string" || typeof entry.channelId !== "string") continue;
                        if (this.getLogFilePath(entry.platform, entry.channelId) !== filePath) continue;
                        add({ platform: entry.platform, channelId: entry.channelId });
                        identified = true;
                    } catch { /* 空行或损坏记录不参与会话发现。 */ }
                }
                if (identified) continue;
                const known = knownChannels.filter(channel => this.getLogFilePath(channel.platform, channel.channelId) === filePath);
                if (known.length === 1) {
                    add(known[0]);
                    continue;
                }
                const channelId = path.basename(file.name, ".agent.jsonl");
                // 冒号和下划线在旧文件名中不可区分，不能凭文件名生成错误会话的日记。
                if (known.length > 1 || channelId.includes("_")) {
                    this.logger.warn(`旧日志缺少可确认的会话编号，跳过日记发现: ${filePath}`);
                    continue;
                }
                add({ platform: directory.name, channelId });
            }
        }
        return [...channels.values()];
    }

    public async getAgentHistoryForDateRange(
        platform: string,
        channelId: string,
        startDate: Date,
        endDate: Date,
        knownChannels?: { platform: string; channelId: string }[]
    ): Promise<AgentLogEntry[]> {
        const filePath = this.getLogFilePath(platform, channelId);
        try {
            const knownOwners = knownChannels && new Set(knownChannels
                .filter(channel => this.getLogFilePath(channel.platform, channel.channelId) === filePath)
                .map(channel => JSON.stringify([channel.platform, channel.channelId])));
            const allowLegacy = !knownOwners ||
                (knownOwners.size === 1 && knownOwners.has(JSON.stringify([platform, channelId]))) ||
                (knownOwners.size === 0 && !path.basename(filePath, ".agent.jsonl").includes("_"));
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            const entries: AgentLogEntry[] = [];
            for (const line of lines) {
                if (!line) continue;
                const entry = JSON.parse(line) as AgentLogEntry;
                if ((entry.platform === undefined || entry.channelId === undefined) && !allowLegacy) continue;
                if (entry.platform !== undefined && entry.platform !== platform) continue;
                if (entry.channelId !== undefined && entry.channelId !== channelId) continue;
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
