import fs from "fs/promises";
import { Context, h, Service } from "koishi";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { IChatModel, IEmbedModel, TaskType } from "@/services/model";
import { loadPrompt, PromptService } from "@/services/prompt";
import { Services, TableName } from "@/services/types";
import { DialogueSegmentData, MemberData, MessageData } from "@/services/worldstate";
import { AppError, ErrorCodes } from "@/shared/errors";
import { cosineSimilarity, formatDate, hashString, JsonParser } from "@/shared/utils";
import { MemoryConfig } from "./config";
import { MemoryBlock } from "./MemoryBlock";
import {
    ExtractedFact,
    ExtractedInsight,
    Fact,
    Insight,
    MemoryBlockData,
    MemoryOperationResult,
    ProfileConsolidationOptions,
    SearchOptions,
    UserProfile,
} from "./types";
import { CircuitBreaker } from "./utils/CircuitBreaker";
import { LockManager } from "./utils/LockManager";
import { PerformanceMonitor } from "./utils/PerformanceMonitor";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
    interface Tables {
        [TableName.Facts]: Fact;
        [TableName.Insights]: Insight;
        [TableName.UserProfiles]: UserProfile;
    }
}

/**
 * 记忆服务接口
 *
 * 提供完整的用户记忆管理功能，包括：
 * - 用户事实存储：存储和检索用户相关的记忆事实
 * - 语义搜索：基于向量嵌入的相似度搜索
 * - 用户画像：动态生成和更新用户画像
 * - 数据维护：记忆衰减、去重、一致性检查
 *
 * @example
 * ```typescript
 * // 添加用户事实
 * const factResult = await memoryService.addUserFact({
 *   userId: 'user123',
 *   userName: '张三',
 *   content: '张三喜欢编程',
 *   type: FactType.Preference,
 *   lifespan: LifespanType.Long,
 *   sourceMessageIds: ['msg001']
 * });
 *
 * // 搜索用户相关事实
 * const searchResult = await memoryService.searchUserFacts('编程', {
 *   userIds: ['user123'],
 *   limit: 5
 * });
 * ```
 */
export interface IMemoryService {
    // === 用户事实管理 ===
    /**
     * 添加用户事实
     * @param factData 事实数据
     * @returns 创建的事实
     */
    addUserFact(
        factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">
    ): Promise<MemoryOperationResult<Fact>>;

    /**
     * 搜索用户事实
     * @param query 搜索查询
     * @param options 搜索选项
     * @returns 匹配的事实列表
     */
    searchUserFacts(query: string, options?: SearchOptions): Promise<MemoryOperationResult<Fact[]>>;

    /**
     * 获取用户的所有事实
     * @param userId 用户ID
     * @param options 搜索选项
     * @returns 用户的事实列表
     */
    getUserFacts(userId: string, options?: SearchOptions): Promise<MemoryOperationResult<Fact[]>>;

    /**
     * 更新事实访问信息
     * @param factId 事实ID
     * @returns 更新结果
     */
    updateFactAccess(factId: string): Promise<MemoryOperationResult<void>>;

    // === 用户画像管理 ===
    /**
     * 获取用户画像
     * @param userId 用户ID
     * @returns 用户画像
     */
    getUserProfile(userId: string): Promise<MemoryOperationResult<UserProfile | null>>;

    /**
     * 搜索用户画像
     * @param query 搜索查询
     * @param options 搜索选项
     * @returns 匹配的用户画像列表
     */
    searchUserProfiles(query: string, options?: SearchOptions): Promise<MemoryOperationResult<UserProfile[]>>;

    /**
     * 整合用户画像
     * @param userId 用户ID
     * @param options 整合选项
     * @returns 更新后的用户画像
     */
    /* prettier-ignore */
    consolidateProfile(userId: string, options?: ProfileConsolidationOptions): Promise<MemoryOperationResult<UserProfile | null>>;

    // === 维护操作 ===
    /**
     * 执行记忆衰减与遗忘
     * @returns 操作结果
     */
    decayAndForget(): Promise<MemoryOperationResult<{ removedCount: number }>>;
}

export class MemoryService extends Service<MemoryConfig> implements IMemoryService {
    static readonly inject = [Services.Logger, Services.Prompt, Services.Model, "database"];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    private readonly promptService: PromptService;
    private readonly chatModel: IChatModel;
    private readonly embeddingModel: IEmbedModel;
    private readonly jsonParser = new JsonParser<{ facts: ExtractedFact[]; insights: ExtractedInsight[] }>();

    // 工具类实例
    private readonly lockManager: LockManager;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly performanceMonitor: PerformanceMonitor;

    // 定时器引用，用于清理
    private maintenanceTimer?: NodeJS.Timeout;

    // 处理中的操作计数，用于优雅关闭
    private activeOperations = 0;
    private isShuttingDown = false;

    // 缓存系统
    private readonly profileCache = new Map<string, { data: UserProfile; timestamp: number }>();
    private readonly factsCache = new Map<string, { data: Fact[]; timestamp: number }>();
    private cacheCleanupTimer?: NodeJS.Timeout;

    /**
     * 性能监控装饰器
     */
    private async withPerformanceMonitoring<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
        return this.performanceMonitor.track(operationName, operation);
    }

    /**
     * 获取性能统计信息
     */
    public getPerformanceStats(): Record<string, any> {
        return this.performanceMonitor.getStats();
    }

    constructor(ctx: Context, config: MemoryConfig) {
        super(ctx, Services.Memory, true);
        this.config = config;
        this.promptService = ctx[Services.Prompt];

        // 从模型服务获取所需的模型实例
        this.chatModel = this.ctx[Services.Model].useChatGroup(TaskType.Memory)?.current;
        this.embeddingModel = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding)?.current;
        this.logger = ctx[Services.Logger].getLogger("[记忆服务]");

        if (!this.chatModel || !this.embeddingModel) {
            this.logger.warn("聊天模型或嵌入模型不可用，记忆服务功能将受限。");
        }

        // 初始化工具类
        this.lockManager = new LockManager(config.errorHandling.lockTimeoutMs);
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: config.errorHandling.circuitBreakerThreshold,
            resetTimeoutMs: config.errorHandling.circuitBreakerResetMs,
            monitoringPeriodMs: 60000, // 1分钟监控周期
        });
        this.performanceMonitor = new PerformanceMonitor();
    }

    protected async start(): Promise<void> {
        this.registerDatabaseModels();
        this.registerPromptTemplates();
        await this.discoverAndLoadCoreMemoryBlocks();

        // 监听消息事件以收集记忆素材
        this.ctx.on("worldstate:summary", (aiIdentity, foldedSegments) =>
            this.handleSummaryChunk(aiIdentity, foldedSegments)
        );

        // 启动定期维护任务
        this.startMaintenanceTasks();

        // 启动缓存清理任务
        this.startCacheCleanup();

        this.logger.info("服务已启动，开始监听消息。");
    }

    protected async stop(): Promise<void> {
        this.isShuttingDown = true;

        // 清理定时器
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = undefined;
        }
        if (this.cacheCleanupTimer) {
            clearInterval(this.cacheCleanupTimer);
            this.cacheCleanupTimer = undefined;
        }

        // 等待所有活跃操作完成
        const maxWaitTime = 30000; // 30秒
        const startTime = Date.now();

        while (this.activeOperations > 0 && Date.now() - startTime < maxWaitTime) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (this.activeOperations > 0) {
            this.logger.warn(`服务停止时仍有 ${this.activeOperations} 个操作未完成`);
        }

        // 清理所有资源
        this.lockManager.clearAllLocks();
        this.circuitBreaker.reset();
        this.performanceMonitor.stop();

        this.logger.info("服务已停止。");
    }

    /**
     * 启动定期维护任务
     */
    private startMaintenanceTasks(): void {
        // 每小时执行一次维护任务
        this.maintenanceTimer = setInterval(async () => {
            try {
                await this.performMaintenance();
            } catch (error) {
                this.logger.error("定期维护任务执行失败:", error);
            }
        }, 60 * 60 * 1000); // 1小时
    }

    /**
     * 执行定期维护任务
     */
    private async performMaintenance(): Promise<void> {
        if (this.isShuttingDown) return;

        this.logger.info("开始执行定期维护任务...");

        try {
            // 执行记忆衰减与遗忘
            const forgetResult = await this.decayAndForget();
            if (forgetResult.success && forgetResult.data) {
                this.logger.info(`维护任务：遗忘了 ${forgetResult.data.removedCount} 条陈旧事实`);
            }

            // 执行数据一致性检查
            const consistencyResult = await this.performDataConsistencyCheck();
            if (consistencyResult.success) {
                this.logger.info("维护任务：数据一致性检查完成");
            }
        } catch (error) {
            this.logger.error("维护任务执行失败:", error);
        }
    }

    /**
     * 注册所有数据库模型
     */
    private registerDatabaseModels() {
        this.ctx.model.extend(
            TableName.Facts,
            {
                id: "string(64)",
                userId: "string(64)", // 直接关联用户ID
                userName: "string(255)", // 用户名称
                content: "text",
                embedding: "array",
                type: "string(32)", // FactType 枚举值
                lifespan: "string(32)", // LifespanType 枚举值
                sourceMessageIds: "array", // 支持多条消息ID
                salience: "float",
                createdAt: "timestamp",
                lastAccessedAt: "timestamp",
                accessCount: "integer",
                isDeleted: { type: "boolean", initial: false },
                updatedAt: "timestamp",
            },
            { primary: "id", unique: [], foreign: {} }
        );

        this.ctx.model.extend(
            TableName.Insights,
            {
                id: "string(64)",
                content: "text",
                embedding: "array",
                type: "string(32)", // InsightType 枚举值
                relatedUserIds: "array", // 涉及的用户ID数组
                sourceMessageIds: "array", // 关键来源消息ID数组
                lifespan: "string(32)", // LifespanType 枚举值
                salience: "float",
                createdAt: "timestamp",
                lastAccessedAt: "timestamp",
                accessCount: "integer",
                isDeleted: { type: "boolean", initial: false },
                updatedAt: "timestamp",
            },
            { primary: "id", unique: [], foreign: {} }
        );

        this.ctx.model.extend(
            TableName.UserProfiles,
            {
                id: "string(64)",
                userId: "string(64)", // 直接关联用户ID
                userName: "string(255)", // 用户名称
                content: "text",
                embedding: "array",
                supportingFactIds: "array",
                updatedAt: "timestamp",
                createdAt: "timestamp",
                version: "integer",
                salience: "float",
                confidence: "float", // 画像置信度评分
                keyFactsForUpdate: "array",
                isDeleted: { type: "boolean", initial: false },
                tags: "array",
            },
            { primary: "id", unique: [["userId"]] } // 每个用户只能有一个画像
        );
    }

    /**
     * 注册所有提示词模板
     */
    private registerPromptTemplates() {
        this.promptService.registerTemplate("memory.fact_extraction", loadPrompt("memory/fact_retrieval"));
        /* prettier-ignore */
        this.promptService.registerTemplate("memory.profile_consolidation", loadPrompt("memory/profile_consolidation"));
    }

    /**
     * 获取所有核心记忆块的数据，用于渲染
     * @returns
     */
    public async getMemoryBlocksForRendering(): Promise<MemoryBlockData[]> {
        return Array.from(this.coreMemoryBlocks.values()).map((block) => ({
            title: block.title,
            label: block.label,
            description: block.description,
            content: block.content as string[],
        }));
    }

    /**
     * 扫描核心记忆目录，加载所有可用的记忆块。
     * @returns
     */
    private async discoverAndLoadCoreMemoryBlocks() {
        const memoryPath = this.config.coreMemoryPath;
        try {
            await fs.mkdir(memoryPath, { recursive: true });
            const files = await fs.readdir(memoryPath);
            const memoryFiles = files.filter((file) => file.endsWith(".md") || file.endsWith(".txt"));

            if (memoryFiles.length === 0) {
                this.logger.warn(`核心记忆目录 '${memoryPath}' 为空，未加载任何记忆块。`);
                return;
            }

            for (const file of memoryFiles) {
                const filePath = path.join(memoryPath, file);
                try {
                    const block = await MemoryBlock.createFromFile(this.ctx, filePath);
                    if (this.coreMemoryBlocks.has(block.label)) {
                        this.logger.warn(`发现重复的记忆块标签 '${block.label}'，来自文件 '${filePath}'。已忽略。`);
                    } else {
                        this.coreMemoryBlocks.set(block.label, block);
                        this.logger.debug(`已从文件 '${file}' 加载核心记忆块 '${block.label}'。`);
                    }
                } catch (error) {
                    //this.logger.error(`加载记忆块文件 '${filePath}' 失败: ${error.message}`);
                }
            }
        } catch (error) {
            this.logger.error(`扫描核心记忆目录 '${memoryPath}' 失败: ${error.message}`);
            throw new AppError("Failed to discover core memory blocks", {
                code: ErrorCodes.SERVICE.INITIALIZATION_FAILURE,
                cause: error,
            });
        }
    }

    /**
     * 带锁的操作执行，支持重试和熔断器
     * @param lockKey 锁的键
     * @param operation 要执行的操作
     * @param options 执行选项
     * @returns 操作结果
     */
    private async withLock<T>(
        lockKey: string,
        operation: () => Promise<T>,
        options: {
            timeoutMs?: number;
            enableCircuitBreaker?: boolean;
        } = {}
    ): Promise<T> {
        const { timeoutMs = this.config.errorHandling.lockTimeoutMs, enableCircuitBreaker = true } = options;

        // 检查熔断器状态
        if (enableCircuitBreaker) {
            const breakerResult = await this.circuitBreaker.execute(async () => {
                // 使用锁管理器执行操作
                const lockResult = await this.lockManager.withLock(lockKey, operation, timeoutMs);

                if (!lockResult.success) {
                    throw new Error(lockResult.error || "操作失败");
                }

                return lockResult.data!;
            });

            if (!breakerResult.success) {
                throw new AppError(breakerResult.error || "操作失败", {
                    code:
                        breakerResult.state === "OPEN"
                            ? ErrorCodes.OPERATION.CIRCUIT_BREAKER_OPEN
                            : ErrorCodes.OPERATION.RETRY_EXHAUSTED,
                    context: { lockKey, breakerState: breakerResult.state },
                });
            }

            return breakerResult.data!;
        } else {
            // 不使用熔断器，直接使用锁管理器
            const lockResult = await this.lockManager.withLock(lockKey, operation, timeoutMs);

            if (!lockResult.success) {
                throw new AppError(lockResult.error || "操作失败", {
                    code: lockResult.lockAcquired
                        ? ErrorCodes.OPERATION.RETRY_EXHAUSTED
                        : ErrorCodes.OPERATION.LOCK_TIMEOUT,
                    context: { lockKey, lockAcquired: lockResult.lockAcquired },
                });
            }

            return lockResult.data!;
        }
    }

    /**
     * 智能获取用户画像相关的事实
     * 支持增量更新和全量更新
     */
    /* prettier-ignore */
    private async getRelevantFactsForProfile(userId: string, existingProfile: UserProfile | null, forceReconsolidate: boolean): Promise<{ relevantFacts: Fact[]; insights: Insight[]; newFactsOnly: boolean, }> {
        const config = this.config.profileGeneration;

        // 获取所有相关事实
        const allFacts = await this.ctx.database.get(TableName.Facts, {
            userId: userId,
            isDeleted: false,
        });

        const insights = await this.ctx.database.get(TableName.Insights, {
            relatedUserIds: { $some: [userId] },
            isDeleted: false,
        });

        if (!existingProfile || forceReconsolidate || !config.enableIncrementalUpdate) {
            // 全量更新：返回所有相关事实
            return { relevantFacts: allFacts, insights, newFactsOnly: false };
        }

        // 增量更新：只返回新的事实
        const existingSupportingFactIds = new Set(existingProfile.supportingFactIds || []);
        const newFacts = allFacts.filter((fact) => !existingSupportingFactIds.has(fact.id));
        const newInsights = insights.filter((insight) => !existingSupportingFactIds.has(insight.id));

        // 如果新事实太少，考虑包含一些高权重的旧事实来保持上下文
        if (newFacts.length < config.minFactsForUpdate && allFacts.length > 0) {
            // 选择一些高显著性的旧事实作为上下文
            const contextFacts = allFacts
                .filter((fact) => existingSupportingFactIds.has(fact.id))
                .sort((a, b) => b.salience - a.salience)
                .slice(0, Math.max(2, Math.floor(config.minFactsForUpdate / 2)));


            return {
                relevantFacts: [...newFacts, ...contextFacts],
                insights: newInsights,
                newFactsOnly: false,
            };
        }

        return { relevantFacts: newFacts,  insights: newInsights, newFactsOnly: true };
    }

    /**
     * 计算事实在画像生成中的权重
     */
    private calculateFactWeight(fact: Fact | Insight, existingProfile: UserProfile | null): number {
        let weight = 1.0;

        // 基于显著性的权重
        weight *= 1 + fact.salience;

        // 基于时间的权重（越新的事实权重越高）
        const daysSinceCreation = (Date.now() - fact.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        weight *= Math.max(0.5, 1 - daysSinceCreation * 0.01);

        // 基于访问次数的权重
        weight *= Math.min(1 + fact.accessCount * 0.1, 2.0);

        // 如果是关键事实类型，应用配置的权重倍数
        const keyFactTypes = ["preference", "behavioral_pattern", "core_trait"];
        if (keyFactTypes.includes(fact.type)) {
            weight *= this.config.profileGeneration.keyFactWeight;
        }

        // 新事实获得额外权重
        if (existingProfile && !existingProfile.supportingFactIds?.includes(fact.id)) {
            weight *= 1.2;
        }

        return weight;
    }

    /**
     * 智能更新支持事实ID列表
     * 避免重复处理已参与总结的事实，正确处理增量更新
     */
    private updateSupportingFactIds(
        existingSupportingFactIds: string[],
        relevantFacts: Fact[],
        keyFactsForUpdate: string[] | undefined,
        isIncrementalUpdate: boolean
    ): string[] {
        const existingIds = new Set(existingSupportingFactIds);
        const relevantFactIds = relevantFacts.map((f) => f.id);

        if (!isIncrementalUpdate) {
            // 全量更新：使用所有相关事实
            return relevantFactIds;
        }

        // 增量更新：合并现有事实和新事实
        const newFactIds = relevantFactIds.filter((id) => !existingIds.has(id));

        // 如果LLM指定了关键事实，确保它们被包含
        const keyFactIds = keyFactsForUpdate || [];
        const allImportantIds = new Set([...existingSupportingFactIds, ...newFactIds, ...keyFactIds]);

        // 限制总数以避免过度膨胀
        const maxSupportingFacts = 50; // 可配置
        if (allImportantIds.size > maxSupportingFacts) {
            // 保留最重要的事实
            const factsWithPriority = relevantFacts
                .filter((f) => allImportantIds.has(f.id))
                .sort((a, b) => {
                    // 优先级：关键事实 > 新事实 > 高显著性事实
                    const aIsKey = keyFactIds.includes(a.id) ? 2 : 0;
                    const aIsNew = !existingIds.has(a.id) ? 1 : 0;
                    const bIsKey = keyFactIds.includes(b.id) ? 2 : 0;
                    const bIsNew = !existingIds.has(b.id) ? 1 : 0;

                    const aPriority = aIsKey + aIsNew + a.salience + a.accessCount * 0.01;
                    const bPriority = bIsKey + bIsNew + b.salience + b.accessCount * 0.01;

                    return bPriority - aPriority;
                })
                .slice(0, maxSupportingFacts)
                .map((f) => f.id);

            return factsWithPriority;
        }

        return Array.from(allImportantIds);
    }

    private async renderSegmentsToText(segments: DialogueSegmentData[]): Promise<string> {
        if (!segments || segments.length === 0) return "";

        const segmentIds = segments.map((segment) => segment.id);

        // 1. 一次性获取所有相关消息和系统事件，并按时间排序
        const allMessages = await this.ctx.database
            .select(TableName.Messages)
            .where({ sid: { $in: segmentIds } })
            .orderBy("timestamp", "asc")
            .execute();

        if (allMessages.length === 0) return "";

        // 2. 收集所有唯一的发送者ID，仅从消息中收集
        const senderIds = [...new Set(allMessages.map((msg) => msg.sender.id))];
        const membersMap = new Map<string, MemberData>();
        if (senderIds.length > 0) {
            const membersData = await this.ctx.database.get(TableName.Members, {
                platform: segments[0].platform,
                pid: { $in: senderIds },
            });
            membersData.forEach((member) => membersMap.set(member.pid, member));
        }

        // 3. 格式化为文本
        const dialogueLines = allMessages
            .map((item) => {
                const timestampStr = formatDate(item.timestamp, "HH:mm:ss");

                const allowedTypes = ["text", "at"];

                const msg = item as MessageData;
                const member = membersMap.get(msg.sender.id);
                const senderName = member?.name || msg.sender.name || msg.sender.id;
                const contentText = h
                    .parse(msg.content)
                    .filter((el) => allowedTypes.includes(el.type))
                    .map((el) => el.toString())
                    .join("")
                    .trim();
                if (!contentText) return null;
                return `[${msg.id}|${timestampStr}|${senderName}(${msg.sender.id})] ${contentText.replace(/\n/g, " ")}`;
            })
            .filter(Boolean);

        return dialogueLines.join("\n");
    }

    /**
     * 事件处理主入口：处理从 worldstate 发来的待归档对话片段。
     * @param chunk 包含多用户消息的对话片段
     */
    private async handleSummaryChunk(
        aiIdentity: { id: string; name: string },
        foldedSegments: DialogueSegmentData[]
    ): Promise<void> {
        const chunk = await this.renderSegmentsToText(foldedSegments);

        if (!chunk) {
            this.logger.warn("无法为 folded segments 渲染文本，跳过处理。");
            return;
        }

        // 使用锁防止并发处理相同的chunk
        const chunkHash = hashString(chunk);
        const lockKey = `chunk_${chunkHash}`;

        try {
            await this.withLock(lockKey, async () => {
                // 1. 调用LLM，一次性提取出所有事实和洞察
                const { facts, insights } = await this.extractFromChunk(aiIdentity, chunk);
                this.logger.info(`从 chunk 中提取到 ${facts.length} 条事实和 ${insights.length} 条洞察。`);

                if (facts.length === 0 && insights.length === 0) {
                    return;
                }

                // 2. 将事实和洞察合并，并统一处理
                const allMemories = [...facts, ...insights];

                // 3. 遍历并存储每一条记忆（无论是事实还是洞察）
                await Promise.all(allMemories.map((memory) => this.storeMemory(memory)));

                this.logger.info(`成功处理并存储了 ${allMemories.length} 条新记忆。`);

                const relatedPersons = new Set<string>();

                // 4. 更新用户画像
                for (const memory of facts) {
                    relatedPersons.add(memory.userId);
                }
                for (const insight of insights) {
                    for (const userId of insight.relatedUserIds || []) {
                        relatedPersons.add(userId);
                    }
                }

                // 忽略助手自身
                relatedPersons.delete(aiIdentity.id);

                this.logger.info(`正在更新 ${relatedPersons.size} 个相关用户的画像。`);

                await Promise.all(Array.from(relatedPersons).map((userId) => this.consolidateProfile(userId)));
            });
        } catch (error) {
            this.logger.error("处理 summary chunk 时出错:", error);
        }
    }

    /**
     * 调用LLM从对话片段中提取事实和洞察。
     * @param chunk 对话片段
     * @returns 提取出的事实和洞察对象
     */
    private async extractFromChunk(
        aiIdentity: { id: string; name: string },
        chunk: string
    ): Promise<{ facts: ExtractedFact[]; insights: ExtractedInsight[] }> {
        const prompt = await this.promptService.render("memory.fact_extraction", {
            AI_IDENTITY: aiIdentity,
            CONVERSATION_TEXT: chunk,
        });

        const { text } = await this.chatModel.chat({
            messages: [
                { role: "user", content: prompt },
            ],
            temperature: 0.2,
        });

        const parsedResponse = this.jsonParser.parse(text);
        if (parsedResponse.error || !parsedResponse.data) {
            this.logger.error("解析LLM响应失败:", parsedResponse.error);
            return { facts: [], insights: [] };
        }

        let { facts, insights } = parsedResponse.data;

        if (!Array.isArray(facts)) {
            facts = [];
        }
        if (!Array.isArray(insights)) {
            insights = [];
        }

        return { facts, insights };
    }

    /**
     * 存储单条记忆（事实或洞察）到数据库。
     * @param memoryData 从LLM提取并带有元数据的一条记忆
     */
    private async storeMemory(memoryData: ExtractedFact | ExtractedInsight): Promise<void> {
        try {
            if (!this.embeddingModel) {
                this.logger.error("嵌入模型不可用，无法存储记忆。");
                return;
            }

            const embedding = await this.embeddingModel.embed(memoryData.content).then((res) => res.embedding);

            // 检查是否是事实类型
            if ("type" in memoryData && "userId" in memoryData) {
                // 这是一个 ExtractedFact
                const extractedFact = memoryData as ExtractedFact;
                const newFact: Fact = {
                    id: uuidv4(),
                    userId: extractedFact.userId,
                    userName: extractedFact.userName,
                    content: extractedFact.content,
                    embedding,
                    type: extractedFact.type,
                    lifespan: extractedFact.lifespan,
                    sourceMessageIds: extractedFact.sourceMessageIds,
                    salience: extractedFact.salience,
                    createdAt: new Date(),
                    lastAccessedAt: new Date(),
                    accessCount: 0,
                };

                await this.ctx.database.create(TableName.Facts, newFact);

                // 清除用户相关缓存
                this.clearUserCache(extractedFact.userId);
            } else {
                // 这是一个 ExtractedInsight
                const extractedInsight = memoryData as ExtractedInsight;
                const newInsight: Insight = {
                    id: uuidv4(),
                    content: extractedInsight.content,
                    embedding,
                    type: extractedInsight.insightType,
                    relatedUserIds: extractedInsight.relatedUserIds,
                    sourceMessageIds: extractedInsight.sourceMessageIds,
                    lifespan: extractedInsight.lifespan,
                    salience: extractedInsight.salience,
                    createdAt: new Date(),
                    lastAccessedAt: new Date(),
                    accessCount: 0,
                };

                await this.ctx.database.create(TableName.Insights, newInsight);
            }
        } catch (error) {
            this.logger.error(`存储单条记忆时出错: "${memoryData.content}"`, error);
        }
    }

    // =================================================================================
    // #region IMemoryService 接口实现
    // =================================================================================

    async addUserFact(
        factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">
    ): Promise<MemoryOperationResult<Fact>> {
        try {
            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法创建事实。" };
            }

            // 验证必需字段
            if (!factData.userId || !factData.content) {
                return { success: false, error: "用户ID和内容是必需的字段" };
            }

            const embedding = await this.embeddingModel.embed(factData.content).then((res) => res.embedding);

            const newFact: Fact = {
                ...factData,
                id: uuidv4(),
                embedding,
                createdAt: new Date(),
                lastAccessedAt: new Date(),
                accessCount: 0,
            };

            const createdFact = await this.ctx.database.create(TableName.Facts, newFact);

            // 清除用户相关缓存
            this.clearUserCache(factData.userId);

            return { success: true, data: createdFact };
        } catch (error) {
            this.logger.error(`添加用户事实失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async searchUserFacts(query: string, options: SearchOptions = {}): Promise<MemoryOperationResult<Fact[]>> {
        try {
            const { userIds = [], limit = 10, minSalience = 0, minSimilarity = 0.3, includeDeleted = false } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索。" };
            }

            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            // 数据库查询条件
            const dbQuery: any = {
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            if (userIds.length > 0) {
                dbQuery.userId = { $in: userIds };
            }

            // **注意：这是一个模拟向量搜索的实现！**
            // 在生产环境中，当事实数量巨大时，此方法效率低下。
            // 强烈建议使用支持原生向量搜索的数据库 (e.g., PostgreSQL + pgvector, Qdrant, Milvus)。
            this.logger.info("正在执行模拟向量搜索。对于大数据集，这可能很慢。");

            const allFacts = await this.ctx.database.get(TableName.Facts, dbQuery);

            if (allFacts.length === 0) {
                return { success: true, data: [] };
            }

            // 在内存中计算相似度
            const factsWithSimilarity = allFacts
                .map((fact) => ({
                    ...fact,
                    similarity: cosineSimilarity(queryEmbedding, fact.embedding),
                }))
                .filter((fact) => fact.similarity >= minSimilarity);

            // 按相似度降序排序
            factsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

            return { success: true, data: factsWithSimilarity.slice(0, limit) };
        } catch (error) {
            this.logger.error(`搜索用户事实失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async getUserFacts(userId: string, options: SearchOptions = {}): Promise<MemoryOperationResult<Fact[]>> {
        try {
            // 先尝试从缓存获取
            const cachedFacts = this.getCachedFacts(userId);
            if (cachedFacts) {
                return { success: true, data: cachedFacts };
            }

            const { limit = 100, minSalience = 0, includeDeleted = false } = options;

            // 数据库查询条件
            const dbQuery: any = {
                userId,
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            const facts = await this.ctx.database.get(TableName.Facts, dbQuery);

            // 按创建时间降序排序，限制数量
            const sortedFacts = facts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);

            // 缓存结果
            this.setCachedFacts(userId, sortedFacts);

            return { success: true, data: sortedFacts };
        } catch (error) {
            this.logger.error(`获取用户事实失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async getUserProfile(userId: string): Promise<MemoryOperationResult<UserProfile | null>> {
        try {
            // 先尝试从缓存获取
            const cachedProfile = this.getCachedProfile(userId);
            if (cachedProfile) {
                return { success: true, data: cachedProfile };
            }

            const profiles = await this.ctx.database.get(TableName.UserProfiles, {
                userId,
                isDeleted: false,
            });

            const profile = profiles[0] || null;

            // 缓存结果
            if (profile) {
                this.setCachedProfile(userId, profile);
            }

            return { success: true, data: profile };
        } catch (error) {
            this.logger.error(`获取用户画像失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async searchUserProfiles(
        query: string,
        options: SearchOptions = {}
    ): Promise<MemoryOperationResult<UserProfile[]>> {
        try {
            const { userIds = [], limit = 10, minSalience = 0, minSimilarity = 0.3, includeDeleted = false } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索。" };
            }

            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            // 数据库查询条件
            const dbQuery: any = {
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            if (userIds.length > 0) {
                dbQuery.userId = { $in: userIds };
            }

            const allProfiles = await this.ctx.database.get(TableName.UserProfiles, dbQuery);

            if (allProfiles.length === 0) {
                return { success: true, data: [] };
            }

            // 在内存中计算相似度
            const profilesWithSimilarity = allProfiles
                .map((profile) => ({
                    ...profile,
                    similarity: cosineSimilarity(queryEmbedding, profile.embedding),
                }))
                .filter((profile) => profile.similarity >= minSimilarity);

            // 按相似度降序排序
            profilesWithSimilarity.sort((a, b) => b.similarity - a.similarity);

            return { success: true, data: profilesWithSimilarity.slice(0, limit) };
        } catch (error) {
            this.logger.error(`搜索用户画像失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /* prettier-ignore */
    async addFact(factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">): Promise<MemoryOperationResult<Fact>> {
        try {
            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法创建事实。" };
            }

            const embedding = await this.embeddingModel.embed(factData.content).then((res) => res.embedding);

            const newFact: Fact = {
                ...factData,
                id: uuidv4(),
                embedding,
                createdAt: new Date(),
                lastAccessedAt: new Date(),
                accessCount: 0,
            };

            const createdFact = await this.ctx.database.create(TableName.Facts, newFact);
            return { success: true, data: createdFact };
        } catch (error) {
            this.logger.error(`添加事实失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async updateFactAccess(factId: string): Promise<MemoryOperationResult<void>> {
        try {
            const [fact] = await this.ctx.database.get(TableName.Facts, { id: factId });
            if (!fact) {
                return { success: false, error: "事实不存在" };
            }

            await this.ctx.database.set(
                TableName.Facts,
                { id: factId },
                {
                    lastAccessedAt: new Date(),
                    accessCount: fact.accessCount + 1,
                }
            );
            return { success: true };
        } catch (error) {
            this.logger.error(`更新事实访问信息失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 整合用户的相关事实和洞察，生成或更新其统一的用户画像。
     * 此函数是一个核心的、原子性的操作，通过分布式锁确保同一时间只有一个进程能为指定用户执行整合。
     * 流程包括：获取数据、频率检查、调用大语言模型（LLM）进行分析和总结、最后将结果存入数据库。
     * @param userId - 需要整合画像的用户的唯一标识符。
     * @param options - 可选的配置项，用于控制整合行为，如是否强制执行。
     * @returns 返回一个包含操作结果的对象，成功时 data 字段为更新后的用户画像，失败时包含 error 信息。
     */
    /* prettier-ignore */
    public async consolidateProfile(userId: string, options: ProfileConsolidationOptions = {}): Promise<MemoryOperationResult<UserProfile | null>> {
        // --- 1. 输入验证 ---
        // 确保 userId 是一个有效的非空字符串。
        if (!userId || typeof userId !== 'string') { // 简化了验证逻辑，!userId 会捕获 null, undefined, ''
            throw new AppError('用户ID不能为空', {
                code: ErrorCodes.VALIDATION.INVALID_INPUT,
                context: { userId }
            });
        }

        // --- 2. 分布式锁与性能监控 ---
        // 使用分布式锁确保对同一用户画像的整合操作是串行的，防止数据竞争和不一致。
        const lockKey = `profile_consolidation_${userId}`;
        return this.withLock(lockKey, async () => {
            // 使用性能监控包裹核心逻辑，以便追踪此操作的耗时。
            return this.withPerformanceMonitoring('consolidateProfile', async () => {
                try {
                    // --- 3. 初始化与配置加载 ---
                    // 从 options 和全局配置中解构出本次操作所需的参数。
                    const {
                        forceReconsolidate = false, // 是否强制重新整合，忽略频率限制
                        minFactsThreshold = this.config.profileGeneration.minFactsForUpdate, // 触发更新所需的最少事实数量
                        confidenceThreshold = this.config.profileGeneration.confidenceThreshold, // LLM 生成内容需达到的最低置信度
                    } = options;

                    // --- 4. 获取现有数据与前置检查 ---
                    // 从数据库中获取该用户已存在的画像。`res[0]`直接获取查询结果的第一个元素。
                    const [existingProfile] = await this.ctx.database.get(TableName.UserProfiles, {
                        userId,
                        isDeleted: false
                    });

                    // 检查更新频率，避免在短时间内对同一用户进行不必要的重复整合。
                    if (existingProfile && !forceReconsolidate) {
                        const hoursSinceLastUpdate = (Date.now() - existingProfile.updatedAt.getTime()) / (1000 * 60 * 60);
                        if (hoursSinceLastUpdate < this.config.profileGeneration.updateIntervalHours) {
                            this.logger.info(`用户 ${userId} 的画像更新过于频繁，跳过。距离上次更新仅 ${hoursSinceLastUpdate.toFixed(1)} 小时`);
                            return { success: true, data: existingProfile }; // 返回现有画像，操作成功。
                        }
                    }

                    // 智能获取需要处理的事实和洞察（可能是增量或全量）。
                    const { relevantFacts, insights, newFactsOnly } = await this.getRelevantFactsForProfile(userId, existingProfile, forceReconsolidate);

                    // 如果新的事实和洞察数量未达到阈值，则不执行更新，以节省计算资源。
                    if (relevantFacts.length + insights.length < minFactsThreshold && !forceReconsolidate) {
                        this.logger.info(`用户 ${userId} 没有足够的新事实进行整合，跳过。当前新信息数: ${relevantFacts.length + insights.length}`);
                        return { success: true, data: existingProfile };
                    }

                    // --- 5. 准备LLM输入数据 ---
                    // 确定用户名，优先从事实中获取，否则使用 userId 作为备用。
                    const userName = relevantFacts.length > 0 ? relevantFacts[0].userName : userId;

                    // 创建一个临时ID到真实ID的映射。LLM处理简单的数字ID（如1,2,3）比处理UUID更高效可靠。
                    const tempIdToRealIdMap = new Map<number, string>();

                    // 将所有事实（facts）和洞察（insights）合并到一个列表中，并进行统一处理。
                    const allSources = [...relevantFacts, ...insights];
                    const newFactsAndInsightsForLLM = allSources.map((source, index) => {
                        const tempId = index + 1; // 生成简单的数字ID，从1开始
                        tempIdToRealIdMap.set(tempId, source.id); // 记录临时ID到真实ID的映射关系

                        let content = source.content;
                        // 检查当前项是否为“事实”（通过检查它是否存在于 `relevantFacts` 数组中），以便应用权重。
                        // 这里假设 insight 对象结构与 fact 不同，或可以用其他方式区分。
                        if (relevantFacts.includes(source as any)) { // 'as any' 用于类型兼容，假设结构相似
                            const weight = this.calculateFactWeight(source, existingProfile);
                            if (weight > 1) {
                                content = `[重要] ${content}`; // 为高权重事实添加前缀，引导LLM关注
                            }
                        }

                        return {
                            id: String(tempId), // LLM 输入的ID为字符串形式的数字
                            type: source.type,
                            content: content,
                        };
                    });

                    // 构建发送给LLM的完整输入对象。
                    const inputForLLM = {
                        userId,
                        userName,
                        existingProfile: existingProfile?.content || "这是一个关于该用户的新画像。",
                        isIncrementalUpdate: newFactsOnly, // 告知LLM是增量更新还是全量更新
                        factCount: allSources.length,
                        newFactsAndInsights: newFactsAndInsightsForLLM,
                    };

                    // 使用模板引擎生成最终的Prompt。
                    const prompt = await this.promptService.render("memory.profile_consolidation", inputForLLM);

                    // --- 6. 调用LLM并解析结果 ---
                    const response = await this.chatModel.chat({
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.2, //较低的温度使输出更具确定性和事实性
                    });

                    // 解析LLM返回的JSON字符串。
                    const parser = new JsonParser<any>();
                    const result = parser.parse(response.text);

                    if (result.error) {
                        this.logger.error(`整合用户 ${userId} 画像时LLM响应解析失败: ${result.error}`, { responseText: response.text });
                        return { success: false, error: `LLM响应解析失败: ${result.error}` };
                    }

                    const { profile_content, confidence_score, key_source_ids } = result.data;

                    // 如果LLM对自己生成内容的置信度低于阈值，则放弃本次更新。
                    if (confidence_score < confidenceThreshold) {
                        this.logger.warn(`用户 ${userId} 的画像生成置信度过低 (${confidence_score})，跳过更新。`);
                        return { success: true, data: existingProfile };
                    }

                    // --- 7. 数据持久化 ---
                    // 将LLM返回的临时数字ID转换回真实的数据库ID。
                    const realKeySourceIds = key_source_ids.map((id: string) => tempIdToRealIdMap.get(Number(id))!).filter(Boolean);

                    // 智能地更新支持该画像的事实ID列表。
                    const updatedSupportingFactIds = this.updateSupportingFactIds(
                        existingProfile?.supportingFactIds || [],
                        relevantFacts,
                        realKeySourceIds,
                        newFactsOnly
                    );

                    // 为新的画像内容生成向量嵌入，用于后续的相似度检索。
                    const { embedding } = await this.embeddingModel.embed(profile_content);

                    // 准备要写入数据库的最终数据。
                    const updatedProfileData: Omit<UserProfile, 'id' | 'createdAt'> = {
                        userId,
                        userName,
                        content: profile_content,
                        embedding,
                        confidence: confidence_score,
                        supportingFactIds: updatedSupportingFactIds,
                        updatedAt: new Date(),
                        version: (existingProfile?.version || 0) + 1,
                        keyFactsForUpdate: realKeySourceIds, // 保存本次更新所依赖的关键事实ID，供下次增量更新使用
                    };

                    // 执行数据库的“更新或插入”（Upsert）操作。
                    let updatedProfile: UserProfile;
                    if (existingProfile) {
                        // 如果画像已存在，则更新。
                        await this.ctx.database.set(TableName.UserProfiles, { id: existingProfile.id }, updatedProfileData);
                        updatedProfile = { ...existingProfile, ...updatedProfileData }; // 合并旧数据和新数据以获得完整对象
                    } else {
                        // 如果画像不存在，则创建新记录。
                        updatedProfile = await this.ctx.database.create(TableName.UserProfiles, {
                            id: uuidv4(), // 生成新的主键
                            ...updatedProfileData,
                            createdAt: new Date(), // 设置创建时间
                        });
                    }

                    this.logger.info(`成功为用户 ${userId} 整合并更新了人物画像。版本: ${updatedProfile.version}`);
                    return { success: true, data: updatedProfile };

                } catch (error: any) {
                    this.logger.error(`整合用户 ${userId} 画像时发生意外错误: ${error.message}`, { stack: error.stack });
                    return { success: false, error: error.message };
                }
            });
        });
    }

    /**
     * 数据一致性检查和修复
     * @returns 检查结果
     */
    /* prettier-ignore */
    async performDataConsistencyCheck(): Promise<MemoryOperationResult<{
        missingEmbeddings: number;
        fixedIssues: number;
    }>> {
        try {
            this.logger.info("开始执行数据一致性检查...");

            let missingEmbeddings = 0;
            let fixedIssues = 0;

            // 1. 检查缺失嵌入向量的事实
            const factsWithoutEmbedding = await this.ctx.database.get(TableName.Facts, {
                embedding: null,
                isDeleted: { $ne: true },
            });

            missingEmbeddings = factsWithoutEmbedding.length;

            // 为缺失嵌入向量的事实生成嵌入向量
            if (missingEmbeddings > 0 && this.embeddingModel) {
                for (const fact of factsWithoutEmbedding) {
                    try {
                        const embedding = await this.embeddingModel.embed(fact.content).then((res) => res.embedding);
                        await this.ctx.database.set(
                            TableName.Facts,
                            { id: fact.id },
                            {
                                embedding,
                                updatedAt: new Date(),
                            }
                        );
                        fixedIssues++;
                    } catch (error) {
                        this.logger.warn(`为事实 ${fact.id} 生成嵌入向量失败: ${error.message}`);
                    }
                }
            }

            // 2. 检查缺失嵌入向量的用户画像
            const profilesWithoutEmbedding = await this.ctx.database.get(TableName.UserProfiles, {
                embedding: null,
                isDeleted: { $ne: true },
            });

            const profileMissingEmbeddings = profilesWithoutEmbedding.length;

            // 为缺失嵌入向量的用户画像生成嵌入向量
            if (profileMissingEmbeddings > 0 && this.embeddingModel) {
                for (const profile of profilesWithoutEmbedding) {
                    try {
                        const embedding = await this.embeddingModel.embed(profile.content).then((res) => res.embedding);
                        await this.ctx.database.set(
                            TableName.UserProfiles,
                            { id: profile.id },
                            {
                                embedding,
                                updatedAt: new Date(),
                            }
                        );
                        fixedIssues++;
                    } catch (error) {
                        this.logger.warn(`为用户画像 ${profile.id} 生成嵌入向量失败: ${error.message}`);
                    }
                }
            }

            this.logger.info(
                `数据一致性检查完成: 事实缺失嵌入 ${missingEmbeddings}, 画像缺失嵌入 ${profileMissingEmbeddings}, 已修复 ${fixedIssues}`
            );

            return {
                success: true,
                data: { missingEmbeddings: missingEmbeddings + profileMissingEmbeddings, fixedIssues },
            };
        } catch (error) {
            this.logger.error(`数据一致性检查失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    // ===== 维护操作 =====

    /**
     * 执行记忆衰减与遗忘
     * @returns 操作结果
     */
    async decayAndForget(): Promise<MemoryOperationResult<{ removedCount: number }>> {
        try {
            this.logger.info("开始执行记忆衰减与遗忘...");

            const config = this.config.forgetting;
            const cutoffDate = new Date(Date.now() - config.stalenessDays * 24 * 60 * 60 * 1000);
            let removedCount = 0;

            // 1. 删除过时的低访问频率事实
            const staleFacts = await this.ctx.database.get(TableName.Facts, {
                lastAccessedAt: { $lt: cutoffDate },
                accessCount: { $lt: config.accessCountThreshold },
                isDeleted: { $ne: true },
            });

            for (const fact of staleFacts) {
                await this.ctx.database.set(
                    TableName.Facts,
                    { id: fact.id },
                    {
                        isDeleted: true,
                        updatedAt: new Date(),
                    }
                );
                removedCount++;
            }

            // 2. 删除过时的用户画像（如果用户长时间没有活动）
            const staleProfiles = await this.ctx.database.get(TableName.UserProfiles, {
                updatedAt: { $lt: new Date(Date.now() - config.stalenessDays * 2 * 24 * 60 * 60 * 1000) }, // 画像保留时间更长
                isDeleted: { $ne: true },
            });

            for (const profile of staleProfiles) {
                // 检查该用户是否还有活跃的事实
                const activeFacts = await this.ctx.database.get(TableName.Facts, {
                    userId: profile.userId,
                    lastAccessedAt: { $gte: cutoffDate },
                    isDeleted: { $ne: true },
                });

                // 如果用户没有活跃事实，删除画像
                if (activeFacts.length === 0) {
                    await this.ctx.database.set(
                        TableName.UserProfiles,
                        { id: profile.id },
                        {
                            isDeleted: true,
                            updatedAt: new Date(),
                        }
                    );
                    removedCount++;
                }
            }

            this.logger.info(`记忆衰减完成，共删除了 ${removedCount} 条记录`);
            return { success: true, data: { removedCount } };
        } catch (error) {
            this.logger.error(`记忆衰减失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    // ===== 缓存相关方法 =====

    /**
     * 启动缓存清理任务
     */
    private startCacheCleanup(): void {
        if (!this.config.caching.enabled) {
            return;
        }

        const intervalMs = this.config.caching.cleanupIntervalMinutes * 60 * 1000;
        this.cacheCleanupTimer = setInterval(() => {
            this.cleanupExpiredCache();
        }, intervalMs);

        this.logger.info(`缓存清理任务已启动，间隔: ${this.config.caching.cleanupIntervalMinutes} 分钟`);
    }

    /**
     * 清理过期的缓存条目
     */
    private cleanupExpiredCache(): void {
        const now = Date.now();
        const profileTtlMs = this.config.caching.profileCacheTtlMinutes * 60 * 1000;
        const factsTtlMs = this.config.caching.factsCacheTtlMinutes * 60 * 1000;

        // 清理用户画像缓存
        let cleanedProfiles = 0;
        for (const [key, entry] of this.profileCache.entries()) {
            if (now - entry.timestamp > profileTtlMs) {
                this.profileCache.delete(key);
                cleanedProfiles++;
            }
        }

        // 清理事实缓存
        let cleanedFacts = 0;
        for (const [key, entry] of this.factsCache.entries()) {
            if (now - entry.timestamp > factsTtlMs) {
                this.factsCache.delete(key);
                cleanedFacts++;
            }
        }

        // 检查缓存大小限制
        this.enforceMaxCacheSize();

        if (cleanedProfiles > 0 || cleanedFacts > 0) {
            this.logger.debug(`缓存清理完成: 清理了 ${cleanedProfiles} 个画像缓存, ${cleanedFacts} 个事实缓存`);
        }
    }

    /**
     * 强制执行最大缓存大小限制
     */
    private enforceMaxCacheSize(): void {
        const maxEntries = this.config.caching.maxCacheEntries;

        // 如果画像缓存超过限制，删除最旧的条目
        if (this.profileCache.size > maxEntries) {
            const entries = Array.from(this.profileCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toDelete = entries.slice(0, this.profileCache.size - maxEntries);
            toDelete.forEach(([key]) => this.profileCache.delete(key));
        }

        // 如果事实缓存超过限制，删除最旧的条目
        if (this.factsCache.size > maxEntries) {
            const entries = Array.from(this.factsCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toDelete = entries.slice(0, this.factsCache.size - maxEntries);
            toDelete.forEach(([key]) => this.factsCache.delete(key));
        }
    }

    /**
     * 从缓存获取用户画像
     */
    private getCachedProfile(userId: string): UserProfile | null {
        if (!this.config.caching.enabled) {
            return null;
        }

        const entry = this.profileCache.get(userId);
        if (!entry) {
            this.recordCacheMiss("profile");
            return null;
        }

        const ttlMs = this.config.caching.profileCacheTtlMinutes * 60 * 1000;
        if (Date.now() - entry.timestamp > ttlMs) {
            this.profileCache.delete(userId);
            this.recordCacheMiss("profile");
            return null;
        }

        this.recordCacheHit("profile");
        return entry.data;
    }

    /**
     * 缓存用户画像
     */
    private setCachedProfile(userId: string, profile: UserProfile): void {
        if (!this.config.caching.enabled) {
            return;
        }

        this.profileCache.set(userId, {
            data: profile,
            timestamp: Date.now(),
        });
    }

    /**
     * 从缓存获取用户事实
     */
    private getCachedFacts(userId: string): Fact[] | null {
        if (!this.config.caching.enabled) {
            return null;
        }

        const entry = this.factsCache.get(userId);
        if (!entry) {
            this.recordCacheMiss("facts");
            return null;
        }

        const ttlMs = this.config.caching.factsCacheTtlMinutes * 60 * 1000;
        if (Date.now() - entry.timestamp > ttlMs) {
            this.factsCache.delete(userId);
            this.recordCacheMiss("facts");
            return null;
        }

        this.recordCacheHit("facts");
        return entry.data;
    }

    /**
     * 缓存用户事实
     */
    private setCachedFacts(userId: string, facts: Fact[]): void {
        if (!this.config.caching.enabled) {
            return;
        }

        this.factsCache.set(userId, {
            data: facts,
            timestamp: Date.now(),
        });
    }

    /**
     * 清除用户相关的所有缓存
     */
    private clearUserCache(userId: string): void {
        this.profileCache.delete(userId);
        this.factsCache.delete(userId);
    }

    /**
     * 记录缓存命中
     */
    private recordCacheHit(type: string): void {
        this.performanceMonitor.recordCacheHit(type);
    }

    /**
     * 记录缓存未命中
     */
    private recordCacheMiss(type: string): void {
        this.performanceMonitor.recordCacheMiss(type);
    }
}
