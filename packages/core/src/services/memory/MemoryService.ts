import fs from "fs/promises";
import { Context, h, Logger, Service } from "koishi";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { IChatModel, IEmbedModel, TaskType } from "@/services/model";
import { loadPrompt, PromptService } from "@/services/prompt";
import { Services, TableName } from "@/services/types";
import { ContextualMessage, MemberData, MessageData } from "@/services/worldstate";
import { AppError, ErrorCodes } from "@/shared/errors";
import { cosineSimilarity, formatDate, JsonParser } from "@/shared/utils";
import { Query } from "koishi";
import { MemoryConfig } from "./config";
import { MemoryBlock } from "./MemoryBlock";
import {
    ExtractedFact,
    ExtractedInsight,
    Fact,
    Insight,
    MemoryBlockData,
    MemoryOperationResult,
    MemorySearchResult,
    ProfileConsolidationOptions,
    Searchable,
    SearchOptions,
    UserProfile,
} from "./types";
import { CircuitBreaker } from "./utils/CircuitBreaker";
import { LockManager } from "./utils/LockManager";

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

// =========================================================================
// #region 主服务类
// =========================================================================

export class MemoryService extends Service<MemoryConfig> {
    static readonly inject = [Services.Logger, Services.Prompt, Services.Model, "database"];

    // 辅助类实例
    private ingestor: MemoryIngestor;
    private consolidator: ProfileConsolidator;
    private maintenance: MemoryMaintenance;
    private cache: MemoryCache;
    private coreMemoryLoader: CoreMemoryLoader;

    // 工具类实例
    private readonly lockManager: LockManager;
    private readonly circuitBreaker: CircuitBreaker;

    // 模型实例
    private readonly chatModel: IChatModel;
    private readonly embeddingModel: IEmbedModel;

    // 定时器引用
    private maintenanceTimer?: NodeJS.Timeout;

    // 优雅关闭相关
    private activeOperations = 0;
    private isShuttingDown = false;

    private promptService: PromptService;

    constructor(ctx: Context, config: MemoryConfig) {
        super(ctx, Services.Memory, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[记忆服务]");
        this.promptService = ctx[Services.Prompt];

        // 初始化模型
        this.chatModel = this.ctx[Services.Model].useChatGroup(TaskType.Memory)?.current;
        this.embeddingModel = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding)?.current;
        if (!this.chatModel || !this.embeddingModel) {
            this.logger.warn("聊天模型或嵌入模型不可用，记忆服务功能将受限");
        }

        // 初始化工具类
        this.lockManager = new LockManager(config.errorHandling.lockTimeoutMs);
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: config.errorHandling.circuitBreakerThreshold,
            resetTimeoutMs: config.errorHandling.circuitBreakerResetMs,
            monitoringPeriodMs: 60000,
        });

        // 实例化辅助类
        this.cache = new MemoryCache(this.config, this.logger);
        this.coreMemoryLoader = new CoreMemoryLoader(this.ctx, this.config, this.logger);
        this.consolidator = new ProfileConsolidator(
            this.ctx,
            this.config,
            this.logger,
            this.chatModel,
            this.embeddingModel,
            this.ctx[Services.Prompt]
        );
        this.maintenance = new MemoryMaintenance(this.ctx, this.config, this.logger, this.embeddingModel);
        this.ingestor = new MemoryIngestor(
            this.ctx,
            this.config,
            this.logger,
            this.chatModel,
            this.embeddingModel,
            this.ctx[Services.Prompt],
            // 传入一个回调来触发画像整合，避免循环依赖
            (userId: string) => this.consolidateProfile(userId),
            (userId: string) => this.cache.clearUserCache(userId)
        );
    }

    protected async start(): Promise<void> {
        this.registerModels();
        this.registerPromptTemplates();
        this.registerCommands();
        await this.coreMemoryLoader.loadCoreMemoryBlocks();

        this.ctx.on("worldstate:summary", (summaryChunk) => this.ingestor.handleSummaryChunk(summaryChunk));

        this.startMaintenanceTasks();
        this.cache.startCacheCleanup();
    }

    protected async stop(): Promise<void> {
        this.isShuttingDown = true;
        if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
        this.cache.stopCacheCleanup();

        // 优雅关闭逻辑
        const maxWaitTime = 30000;
        const startTime = Date.now();
        while (this.activeOperations > 0 && Date.now() - startTime < maxWaitTime) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (this.activeOperations > 0) {
            this.logger.warn(`服务停止时仍有 ${this.activeOperations} 个操作未完成`);
        }

        this.lockManager.clearAllLocks();
        this.circuitBreaker.reset();
        this.logger.info("服务已停止");
    }

    private startMaintenanceTasks(): void {
        this.maintenanceTimer = setInterval(async () => {
            if (this.isShuttingDown) return;
            try {
                await this.maintenance.performMaintenance();
            } catch (error) {
                this.logger.error("定期维护任务执行失败:", error);
            }
        }, 60 * 60 * 1000); // 1小时
    }

    // === 注册与初始化方法 ===
    /**
     * 注册所有数据库模型
     */
    private registerModels() {
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
                contextId: "string(32)",
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
                contextId: "string(32)",
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

    private registerCommands() {
        const memoryCmd = this.ctx.command("memory", "记忆管理", { authority: 3 });

        // 手动触发画像更新
        memoryCmd
            .subcommand(".update", "手动触发用户画像更新")
            .option("user", "-u <user:string> 指定用户ID")
            .action(async ({ session, options }) => {
                const userId = options.user || session.userId;
                try {
                    const result = await this.consolidateProfile(userId, { forceReconsolidate: true });
                    if (result.success) {
                        return "用户画像更新成功";
                    } else {
                        return `用户画像更新失败: ${result.error}`;
                    }
                } catch (error) {
                    this.logger.error("手动触发画像更新失败", error);
                    return "画像更新失败：" + error.message;
                }
            });

        // 清理所有记忆
        memoryCmd
            .subcommand(".clear", "清理所有记忆")
            .option("delete", "--delete 永久删除记忆，而非标记为已删除", { type: "boolean" })
            .action(async ({ options }) => {
                if (options.delete) {
                    try {
                        await this.ctx.database.remove(TableName.Facts, {});
                        await this.ctx.database.remove(TableName.Insights, {});
                        await this.ctx.database.remove(TableName.UserProfiles, {});
                        return "所有记忆已永久删除";
                    } catch (error) {
                        this.logger.error("永久删除所有记忆失败", error);
                        return "清理失败：" + error.message;
                    }
                } else {
                    try {
                        await this.ctx.database.set(TableName.Facts, {}, { isDeleted: true });
                        await this.ctx.database.set(TableName.Insights, {}, { isDeleted: true });
                        await this.ctx.database.set(TableName.UserProfiles, {}, { isDeleted: true });
                        return "所有记忆已清理完毕";
                    } catch (error) {
                        this.logger.error("清理所有记忆失败", error);
                        return "清理失败：" + error.message;
                    }
                }
            });
    }

    /**
     * 注册所有提示词模板
     */
    private registerPromptTemplates() {
        this.promptService.registerTemplate("memory.fact_extraction", loadPrompt("memory/fact_retrieval"));
        /* prettier-ignore */
        this.promptService.registerTemplate("memory.profile_consolidation", loadPrompt("memory/profile_consolidation"));
    }

    // === 辅助工具方法 ===

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
     * 构建基础数据库查询对象
     * @param options 搜索选项
     * @param userFilterBuilder 一个函数，用于根据 userIds 构建用户相关的查询部分
     * @returns 构造好的数据库查询对象
     */
    /* prettier-ignore */
    private _buildDbQuery<T extends Searchable>(options: SearchOptions, userFilterBuilder: (userIds: string[]) => Query<T>): Query<Searchable> {
        const { userIds = [], minSalience = 0, includeDeleted = false } = options;

        const dbQuery: Query<Searchable> = {
            salience: { $gte: minSalience },
            ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
        };

        if (userIds.length > 0) {
            Object.assign(dbQuery, userFilterBuilder(userIds));
        }

        return dbQuery;
    }

    /**
     * 执行通用的内存向量搜索逻辑
     * @param queryEmbedding 查询向量
     * @param tableName 数据库表名
     * @param dbQuery 数据库查询条件
     * @param options 搜索选项
     * @param entityName 实体名称，用于日志记录
     * @returns 搜索结果
     */
    private async _executeInMemorySearch<T extends Searchable>(
        queryEmbedding: number[],
        tableName: string,
        dbQuery: Query<T>,
        options: SearchOptions,
        entityName: string
    ): Promise<MemoryOperationResult<(T & { similarity: number })[]>> {
        const { limit = 10, minSimilarity = 0.3 } = options;

        // 1. 从数据库获取预过滤的数据
        // 优化：只获取 embedding 字段可以减少 I/O 和内存占用，但这里为了返回完整对象，获取全部字段
        const allItems = await this.ctx.database.get(tableName as any, dbQuery);

        if (allItems.length === 0) {
            return { success: true, data: [] };
        }

        if (allItems.length > 1000) {
            this.logger.info(`正在对 ${allItems.length} 条'${entityName}'进行内存向量搜索，这可能很慢`);
        }

        // 2. 在内存中计算相似度、过滤、排序和限制数量
        const itemsWithSimilarity = allItems
            .map((item) => ({
                ...item,
                similarity: cosineSimilarity(queryEmbedding, item.embedding),
            }))
            .filter((item) => item.similarity >= minSimilarity);

        itemsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        return { success: true, data: itemsWithSimilarity.slice(0, limit) };
    }

    public async getMemoryBlocksForRendering(): Promise<MemoryBlockData[]> {
        return this.coreMemoryLoader.getMemoryBlocksForRendering();
    }

    // =================================================================================
    // #region IMemoryService 接口实现 (委托给辅助类)
    // =================================================================================

    /**
     * 在内存中对指定类型的实体（'insights' 或 'facts'）进行语义搜索
     * @param type 要搜索的实体类型
     * @param query 搜索查询字符串
     * @param options 搜索选项
     * @returns 包含相似度分数的实体列表
     */
    /* prettier-ignore */
    public async search(type: "insights" | "facts", query: string, options: SearchOptions = {}): Promise<MemoryOperationResult<(Insight | Fact )[]>> {
        if (!this.embeddingModel) {
            return { success: false, error: "嵌入模型不可用，无法执行语义搜索" };
        }

        try {
            // 核心优化：向量化只执行一次
            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            let tableName: string;
            let dbQuery: Query<Insight | Fact>;
            let entityName: string;

            // 根据类型配置不同的查询参数
            if (type === "insights") {
                tableName = TableName.Insights;
                entityName = "用户洞察";
                dbQuery = this._buildDbQuery<Insight>(options, (userIds) => ({
                    relatedUserIds: { $some: userIds },
                }));
            } else {
                // type === 'facts'
                tableName = TableName.Facts;
                entityName = "用户事实";
                dbQuery = this._buildDbQuery<Fact>(options, (userIds) => ({
                    userId: { $in: userIds },
                }));
            }

            // 调用通用的搜索执行器
            return this._executeInMemorySearch(queryEmbedding, tableName, dbQuery, options, entityName);
        } catch (error) {
            this.logger.error(`语义搜索失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /**
 * 使用单个查询嵌入，同时在用户事实（Facts）和洞察（Insights）中进行语义搜索
 * 返回一个按相似度统一排序的混合结果列表
 *
 * @param query 搜索查询字符串
 * @param options 搜索选项，如 limit, minSimilarity 等
 * @returns 一个包含事实和洞察的、按相似度排序的列表
 */
async searchMemories(query: string, options: SearchOptions = {}): Promise<MemoryOperationResult<MemorySearchResult[]>> {
    const {
        userIds = [],
        limit = 10,
        minSalience = 0,
        minSimilarity = 0.3,
        includeDeleted = false
    } = options;

    if (!this.embeddingModel) {
        return { success: false, error: "嵌入模型不可用，无法执行语义搜索" };
    }

    try {
        // --- 1. 生成一次嵌入 ---
        // this.logger.info(`正在为查询生成嵌入: "${query}"`);
        const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

        // --- 2. 并行获取数据 ---
        // 为 'Facts', 'Insights' 和 'UserProfiles'  分别构建数据库查询
        const factDbQuery = this._buildDbQuery<Fact>(options, (ids) => ({ userId: { $in: ids } }));
        const insightDbQuery = this._buildDbQuery<Insight>(options, (ids) => ({ relatedUserIds: { $some: ids } }));
        const profileDbQuery = this._buildDbQuery<UserProfile>(options, (ids) => ({ userId: { $in: ids } }));

        this.logger.info("正在并行从数据库获取事实和洞察...");
        const [allFacts, allInsights, allProfiles] = await Promise.all([
            this.ctx.database.get(TableName.Facts, factDbQuery),
            this.ctx.database.get(TableName.Insights, insightDbQuery),
            this.ctx.database.get(TableName.UserProfiles, profileDbQuery),
        ]);

        const totalItems = allFacts.length + allInsights.length + allProfiles.length;
        this.logger.info(`已获取 ${allFacts.length} 条事实, ${allInsights.length} 条洞察和 ${allProfiles.length} 个用户画像，共 ${totalItems} 条记录待处理`);

        if (totalItems === 0) {
            return { success: true, data: [] };
        }

        if (totalItems > 1000) {
            this.logger.warn(`正在对 ${totalItems} 条记录进行内存向量搜索，这可能非常缓慢并消耗大量内存`);
        }

        // --- 3. 合并数据 ---
        // 为了区分来源，我们给每个对象添加一个 'source' 字段
        const combinedItems: ((Fact & { source: 'fact' }) | (Insight & { source: 'insight' }) | (UserProfile & { source: 'profile' }))[] = [
            ...allFacts.map(fact => ({ ...fact, source: 'fact' as const })),
            ...allInsights.map(insight => ({ ...insight, source: 'insight' as const })),
            ...allProfiles.map(profile => ({ ...profile, source: 'profile' as const })),
        ];

        // --- 4. 统一处理 ---
        // 在合并后的列表上进行相似度计算、过滤、排序和裁剪
        const resultsWithSimilarity = combinedItems
            .map((item) => ({
                ...item,
                similarity: cosineSimilarity(queryEmbedding, item.embedding),
            }))
            .filter((item) => item.similarity >= minSimilarity);

        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        const finalResults = resultsWithSimilarity.slice(0, limit);

        return { success: true, data: finalResults };

    } catch (error) {
        this.logger.error(`搜索记忆失败: ${error.message}`, error);
        return { success: false, error: error.message };
    }
}

    async addUserFact(
        factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">
    ): Promise<MemoryOperationResult<Fact>> {
        try {
            if (!this.embeddingModel) return { success: false, error: "嵌入模型不可用" };
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
            this.cache.clearUserCache(factData.userId);
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
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索" };
            }

            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            // 数据库查询条件
            const dbQuery: Query<Fact> = {
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            if (userIds.length > 0) {
                dbQuery.userId = { $in: userIds };
            }

            const allFacts = await this.ctx.database.get(TableName.Facts, dbQuery);

            // **注意：这是一个模拟向量搜索的实现！**
            // 在生产环境中，当事实数量巨大时，此方法效率低下
            // 强烈建议使用支持原生向量搜索的数据库 (e.g., PostgreSQL + pgvector, Qdrant, Milvus)
            if (allFacts.length > 1000) {
                this.logger.info("正在执行模拟向量搜索对于大数据集，这可能很慢");
            }

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
            this.logger.error(`搜索用户事实失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async getUserFacts(userId: string, options: SearchOptions = {}): Promise<MemoryOperationResult<Fact[]>> {
        const cached = this.cache.getCachedFacts(userId);
        if (cached) return { success: true, data: cached };

        try {
            const { limit = 100, includeDeleted = false } = options;
            const facts = await this.ctx.database.get(TableName.Facts, { userId, isDeleted: { $ne: !includeDeleted } });
            const sortedFacts = facts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
            this.cache.setCachedFacts(userId, sortedFacts);
            return { success: true, data: sortedFacts };
        } catch (error) {
            this.logger.error(`获取用户事实失败: ${error.message}`, error);
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

    /* prettier-ignore */
    async addUserInsight(insightData: Omit<Insight, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">): Promise<MemoryOperationResult<Insight>> {
        try {
            if (!this.embeddingModel) return { success: false, error: "嵌入模型不可用" };
            const embedding = await this.embeddingModel.embed(insightData.content).then((res) => res.embedding);
            const newInsight: Insight = {
                ...insightData,
                id: uuidv4(),
                embedding,
                createdAt: new Date(),
                lastAccessedAt: new Date(),
                accessCount: 0,
            };
            const createdInsight = await this.ctx.database.create(TableName.Insights, newInsight);
            return { success: true, data: createdInsight };
        } catch (error) {
            this.logger.error(`添加用户洞察失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /* prettier-ignore */
    async searchUserInsights(query: string, options: SearchOptions = {}): Promise<MemoryOperationResult<Insight[]>> {
        try {
            const { userIds = [], limit = 10, minSalience = 0, minSimilarity = 0.3, includeDeleted = false } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索" };
            }

            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            // 数据库查询条件
            const dbQuery: Query<Insight> = {
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            if (userIds.length > 0) {
                dbQuery.relatedUserIds = { $some: userIds };
            }

            const allInsights = await this.ctx.database.get(TableName.Insights, dbQuery);

            if (allInsights.length === 0) {
                return { success: true, data: [] };
            }

            // 在内存中计算相似度
            const insightsWithSimilarity = allInsights
                .map((insight) => ({
                    ...insight,
                    similarity: cosineSimilarity(queryEmbedding, insight.embedding),
                }))
                .filter((insight) => insight.similarity >= minSimilarity);

            // 按相似度降序排序
            insightsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

            return { success: true, data: insightsWithSimilarity.slice(0, limit) };
        } catch (error) {
            this.logger.error(`搜索用户洞察失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async getUserInsights(userId: string, options: SearchOptions = {}): Promise<MemoryOperationResult<Insight[]>> {
        try {
            const { limit = 100, includeDeleted = false } = options;
            const insights = await this.ctx.database.get(TableName.Insights, {
                relatedUserIds: { $some: [userId] },
                isDeleted: { $ne: !includeDeleted },
            });
            const sortedInsights = insights
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, limit);
            return { success: true, data: sortedInsights };
        } catch (error) {
            this.logger.error(`获取用户洞察失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async updateInsightAccess(insightId: string): Promise<MemoryOperationResult<void>> {
        try {
            const [insight] = await this.ctx.database.get(TableName.Insights, { id: insightId });
            if (!insight) {
                return { success: false, error: "洞察不存在" };
            }

            await this.ctx.database.set(
                TableName.Insights,
                { id: insightId },
                {
                    lastAccessedAt: new Date(),
                    accessCount: insight.accessCount + 1,
                }
            );
            return { success: true };
        } catch (error) {
            this.logger.error(`更新洞察访问信息失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async getUserProfile(userId: string): Promise<MemoryOperationResult<UserProfile | null>> {
        const cached = this.cache.getCachedProfile(userId);
        if (cached) return { success: true, data: cached };

        try {
            const [profile] = await this.ctx.database.get(TableName.UserProfiles, { userId, isDeleted: false });
            if (profile) this.cache.setCachedProfile(userId, profile);
            return { success: true, data: profile || null };
        } catch (error) {
            this.logger.error(`获取用户画像失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /* prettier-ignore */
    async searchUserProfiles(query: string, options: SearchOptions = {}): Promise<MemoryOperationResult<UserProfile[]>> {
        try {
            const { userIds = [], limit = 10, minSalience = 0, minSimilarity = 0.3, includeDeleted = false } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索" };
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
    public async consolidateProfile(userId: string, options: ProfileConsolidationOptions = {}): Promise<MemoryOperationResult<UserProfile | null>> {
        if (!userId) {
            throw new AppError("用户ID不能为空", { code: ErrorCodes.VALIDATION.INVALID_INPUT });
        }

        const lockKey = `profile_consolidation_${userId}`;
        return this.withLock(lockKey, async () => {
            const result = await this.consolidator.consolidate(userId, options);
            // 成功后更新缓存
            if (result.success && result.data) {
                this.cache.setCachedProfile(userId, result.data);
            }
            return result;
        });
    }

    async decayAndForget(): Promise<MemoryOperationResult<{ removedCount: number }>> {
        return this.maintenance.decayAndForget();
    }
}

// #endregion

// =========================================================================
// #region 辅助类定义
// =========================================================================

class MemoryIngestor {
    private readonly jsonParser = new JsonParser<{ facts: ExtractedFact[]; insights: ExtractedInsight[] }>();

    constructor(
        private ctx: Context,
        private config: MemoryConfig,
        private logger: Logger,
        private chatModel: IChatModel,
        private embeddingModel: IEmbedModel,
        private promptService: PromptService,
        private triggerProfileConsolidation: (userId: string) => Promise<any>,
        private clearUserCache: (userId: string) => void
    ) {}

    public async handleSummaryChunk(summaryChunk: {
        self: { id: string; name: string };
        platform: string;
        contextId: string;
        dialogue: ContextualMessage[];
    }): Promise<void> {
        const chunkText = await this.renderSegmentToText(summaryChunk);
        if (!chunkText) {
            this.logger.warn("无法为 folded segments 渲染文本，跳过处理");
            return;
        }

        try {
            const { facts, insights } = await this.extractFromChunk(summaryChunk.self, chunkText);
            this.logger.info(`从 chunk 中提取到 ${facts.length} 条事实和 ${insights.length} 条洞察`);
            if (facts.length === 0 && insights.length === 0) return;

            const allMemories = [...facts, ...insights];
            await Promise.all(allMemories.map((memory) => this.storeMemory(summaryChunk.contextId, memory)));

            const relatedPersons = new Set<string>();
            facts.forEach((f) => relatedPersons.add(f.userId));
            insights.forEach((i) => i.relatedUserIds?.forEach((id) => relatedPersons.add(id)));
            relatedPersons.delete(summaryChunk.self.id);

            this.logger.info(`正在更新 ${relatedPersons.size} 个相关用户的画像`);
            await Promise.all(Array.from(relatedPersons).map((userId) => this.triggerProfileConsolidation(userId)));
        } catch (error) {
            this.logger.error("处理 summary chunk 时出错:", error);
        }
    }

    private async renderSegmentToText(summaryChunk: {
        self: { id: string; name: string };
        platform: string;
        contextId: string;
        dialogue: ContextualMessage[];
    }): Promise<string> {
        if (!summaryChunk) return "";

        // 1. 一次性获取所有相关消息和系统事件，并按时间排序
        const allMessages = summaryChunk.dialogue;

        if (allMessages.length === 0) return "";

        // 2. 收集所有唯一的发送者ID，仅从消息中收集
        const senderIds = [...new Set(allMessages.map((msg) => msg.sender.id))];
        const membersMap = new Map<string, MemberData>();
        if (senderIds.length > 0) {
            const membersData = await this.ctx.database.get(TableName.Members, {
                platform: summaryChunk.platform,
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
     * 调用LLM从对话片段中提取事实和洞察
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
            messages: [{ role: "user", content: prompt }],
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

    private async storeMemory(contextId: string, memoryData: ExtractedFact | ExtractedInsight): Promise<void> {
        // 几乎与原代码相同，但增加了调用 clearUserCache
        try {
            if (!this.embeddingModel) {
                this.logger.error("嵌入模型不可用，无法存储记忆");
                return;
            }

            const embedding = await this.embeddingModel.embed(memoryData.content).then((res) => res.embedding);

            if ("userId" in memoryData) {
                // Fact
                const factData = memoryData as ExtractedFact;
                await this.ctx.database.create(TableName.Facts, {
                    /* ... */
                });
                this.clearUserCache(factData.userId);
            } else {
                // Insight
                await this.ctx.database.create(TableName.Insights, {
                    /* ... */
                });
            }
        } catch (error) {
            this.logger.error(`存储单条记忆时出错: "${memoryData.content}"`, error);
        }
    }
}

class ProfileConsolidator {
    constructor(
        private ctx: Context,
        private config: MemoryConfig,
        private logger: Logger,
        private chatModel: IChatModel,
        private embeddingModel: IEmbedModel,
        private promptService: PromptService
    ) {}

    public async consolidate(
        userId: string,
        options: ProfileConsolidationOptions = {}
    ): Promise<MemoryOperationResult<UserProfile | null>> {
        // 此方法包含 consolidateProfile 的完整核心逻辑
        // ... 从原 consolidateProfile 方法复制并粘贴其 try-catch 块内的所有代码 ...
        // 注意：删除外层的 withLock 和 withPerformanceMonitoring 调用
        try {
            const { forceReconsolidate = false /* ... */ } = options;
            const [existingProfile] = await this.ctx.database.get(TableName.UserProfiles, { userId, isDeleted: false });
            // ... 后续所有逻辑与原 consolidateProfile 方法完全相同
            return { success: true, data: {} as any }; // 示例返回
        } catch (error: any) {
            this.logger.error(`整合用户 ${userId} 画像时发生意外错误: ${error.message}`);
            return { success: false, error: error.message };
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
}

class MemoryMaintenance {
    constructor(
        private ctx: Context,
        private config: MemoryConfig,
        private logger: Logger,
        private embeddingModel: IEmbedModel
    ) {}

    /**
     * 执行定期维护任务
     */
    public async performMaintenance(): Promise<void> {
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
     * 执行记忆衰减与遗忘
     * @returns 操作结果
     */
    public async decayAndForget(): Promise<MemoryOperationResult<{ removedCount: number }>> {
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
}

class MemoryCache {
    private readonly profileCache = new Map<string, { data: UserProfile; timestamp: number }>();
    private readonly factsCache = new Map<string, { data: Fact[]; timestamp: number }>();
    private cacheCleanupTimer?: NodeJS.Timeout;

    constructor(private config: MemoryConfig, private logger: Logger) {}

    /**
     * 启动缓存清理任务
     */
    public startCacheCleanup(): void {
        if (!this.config.caching.enabled) {
            return;
        }

        const intervalMs = this.config.caching.cleanupIntervalMinutes * 60 * 1000;
        this.cacheCleanupTimer = setInterval(() => {
            this.cleanupExpiredCache();
        }, intervalMs);
    }
    public stopCacheCleanup(): void {
        if (this.cacheCleanupTimer) clearInterval(this.cacheCleanupTimer);
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
    public getCachedProfile(userId: string): UserProfile | null {
        if (!this.config.caching.enabled) {
            return null;
        }
        const entry = this.profileCache.get(userId);
        if (!entry) {
            return null;
        }

        const ttlMs = this.config.caching.profileCacheTtlMinutes * 60 * 1000;
        if (Date.now() - entry.timestamp > ttlMs) {
            this.profileCache.delete(userId);
            return null;
        }
        return entry.data;
    }

    /**
     * 缓存用户画像
     */
    public setCachedProfile(userId: string, profile: UserProfile): void {
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
    public getCachedFacts(userId: string): Fact[] | null {
        if (!this.config.caching.enabled) {
            return null;
        }
        const entry = this.factsCache.get(userId);
        if (!entry) {
            return null;
        }
        const ttlMs = this.config.caching.factsCacheTtlMinutes * 60 * 1000;
        if (Date.now() - entry.timestamp > ttlMs) {
            this.factsCache.delete(userId);
            return null;
        }
        return entry.data;
    }

    /**
     * 缓存用户事实
     */
    public setCachedFacts(userId: string, facts: Fact[]): void {
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
    public clearUserCache(userId: string): void {
        this.profileCache.delete(userId);
        this.factsCache.delete(userId);
    }
}

class CoreMemoryLoader {
    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    constructor(private ctx: Context, private config: MemoryConfig, private logger: Logger) {}

    public getMemoryBlocksForRendering(): MemoryBlockData[] {
        return Array.from(this.coreMemoryBlocks.values()).map((block) => block.toData());
    }

    /**
     * 扫描核心记忆目录，加载所有可用的记忆块
     */
    public async loadCoreMemoryBlocks() {
        const memoryPath = this.config.coreMemoryPath;
        try {
            await fs.mkdir(memoryPath, { recursive: true });
            const files = await fs.readdir(memoryPath);
            const memoryFiles = files.filter((file) => file.endsWith(".md") || file.endsWith(".txt"));

            if (memoryFiles.length === 0) {
                this.logger.warn(`核心记忆目录 '${memoryPath}' 为空，未加载任何记忆块`);
                return;
            }

            for (const file of memoryFiles) {
                const filePath = path.join(memoryPath, file);
                try {
                    const block = await MemoryBlock.createFromFile(this.ctx, filePath);
                    if (this.coreMemoryBlocks.has(block.label)) {
                        this.logger.warn(`发现重复的记忆块标签 '${block.label}'，来自文件 '${filePath}'已忽略`);
                    } else {
                        this.coreMemoryBlocks.set(block.label, block);
                        this.logger.debug(`已从文件 '${file}' 加载核心记忆块 '${block.label}'`);
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
}
