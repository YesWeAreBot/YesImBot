import fs from "fs/promises";
import { Context, h, Query, Service } from "koishi";
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
    Entity,
    EntityMergeOptions,
    EntityType,
    ExtractedFact,
    ExtractedInsight,
    Fact,
    MemoryBlockData,
    MemoryOperationResult,
    ProfileConsolidationOptions,
    SearchOptions,
    UserProfile,
} from "./types";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
    interface Tables {
        [TableName.Entities]: Entity;
        [TableName.Facts]: Fact;
        [TableName.UserProfiles]: UserProfile;
    }
}

/**
 * 记忆服务接口
 *
 * 提供完整的记忆管理功能，包括：
 * - 实体管理：创建、查找、合并实体
 * - 事实存储：存储和检索记忆事实
 * - 语义搜索：基于向量嵌入的相似度搜索
 * - 用户画像：动态生成和更新用户画像
 * - 数据维护：记忆衰减、去重、一致性检查
 *
 * @example
 * ```typescript
 * // 获取或创建用户实体
 * const userResult = await memoryService.getOrCreateUserEntity('user123', {
 *   name: '张三',
 *   platform: 'discord'
 * });
 *
 * // 搜索相关事实
 * const searchResult = await memoryService.searchFacts('编程', {
 *   entityIds: [userResult.data.id],
 *   limit: 5
 * });
 * ```
 */
export interface IMemoryService {
    // === 实体管理 ===
    /**
     * 添加或获取实体
     * @param name 实体名称
     * @param type 实体类型
     * @param metadata 实体元数据
     * @returns 实体对象
     */
    addOrGetEntity(
        name: string,
        type: EntityType,
        metadata?: Record<string, any>
    ): Promise<MemoryOperationResult<Entity>>;

    /**
     * 根据用户ID获取或创建用户实体
     * @param userId 用户ID
     * @param metadata 用户元数据
     * @returns 用户实体
     */
    getOrCreateUserEntity(userId: string, metadata?: Record<string, any>): Promise<MemoryOperationResult<Entity>>;

    /**
     * 查找相似实体
     * @param entity 目标实体
     * @param options 合并选项
     * @returns 相似实体列表
     */
    findSimilarEntities(entity: Entity, options?: EntityMergeOptions): Promise<MemoryOperationResult<Entity[]>>;

    /**
     * 合并重复实体
     * @param sourceEntityId 源实体ID
     * @param targetEntityId 目标实体ID
     * @returns 合并结果
     */
    mergeEntities(sourceEntityId: string, targetEntityId: string): Promise<MemoryOperationResult<Entity>>;

    // === 事实管理 ===
    /**
     * 添加事实
     * @param factData 事实数据
     * @returns 创建的事实
     */
    addFact(
        factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">
    ): Promise<MemoryOperationResult<Fact>>;

    /**
     * 搜索事实
     * @param query 搜索查询
     * @param options 搜索选项
     * @returns 匹配的事实列表
     */
    searchFacts(query: string, options?: SearchOptions): Promise<MemoryOperationResult<Fact[]>>;

    /**
     * 更新事实访问信息
     * @param factId 事实ID
     * @returns 更新结果
     */
    updateFactAccess(factId: string): Promise<MemoryOperationResult<void>>;

    // === 用户画像管理 ===
    /**
     * 获取用户画像
     * @param entityId 实体ID
     * @returns 用户画像
     */
    getUserProfile(entityId: string): Promise<MemoryOperationResult<UserProfile | null>>;

    /**
     * 搜索用户画像
     * @param query 搜索查询
     * @param options 搜索选项
     * @returns 匹配的用户画像列表
     */
    searchUserProfiles(query: string, options?: SearchOptions): Promise<MemoryOperationResult<UserProfile[]>>;

    /**
     * 整合用户画像
     * @param entityId 实体ID
     * @param options 整合选项
     * @returns 更新后的用户画像
     */
    /* prettier-ignore */
    consolidateProfile(entityId: string, options?: ProfileConsolidationOptions): Promise<MemoryOperationResult<UserProfile | null>>;

    // === 维护操作 ===
    /**
     * 执行记忆衰减与遗忘
     * @returns 操作结果
     */
    decayAndForget(): Promise<MemoryOperationResult<{ removedCount: number }>>;

    /**
     * 清理重复实体
     * @param options 合并选项
     * @returns 清理结果
     */
    deduplicateEntities(options?: EntityMergeOptions): Promise<MemoryOperationResult<{ mergedCount: number }>>;
}

export class MemoryService extends Service<MemoryConfig> implements IMemoryService {
    static readonly inject = [Services.Logger, Services.Prompt, Services.Model, "database"];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    private readonly promptService: PromptService;
    private readonly chatModel: IChatModel;
    private readonly embeddingModel: IEmbedModel;
    private readonly jsonParser = new JsonParser<{ facts: ExtractedFact[]; insights: ExtractedInsight[] }>();

    // 增强的任务管理和错误处理系统
    private readonly operationLocks = new Map<string, Promise<any>>();
    private readonly lockTimeouts = new Map<string, NodeJS.Timeout>();
    private readonly retryCounters = new Map<string, number>();
    private readonly circuitBreakers = new Map<string, { failures: number; lastFailure: Date; isOpen: boolean }>();

    // 定时器引用，用于清理
    private maintenanceTimer?: NodeJS.Timeout;

    // 处理中的操作计数，用于优雅关闭
    private activeOperations = 0;
    private isShuttingDown = false;

    // 错误处理配置（从配置文件获取）
    private get errorHandlingConfig() {
        return this.config.errorHandling;
    }

    // 用户画像生成配置（从配置文件获取）
    private get profileGenerationConfig() {
        return this.config.profileGeneration;
    }

    // 性能监控
    private readonly performanceMetrics = {
        operationCounts: new Map<string, number>(),
        operationTimes: new Map<string, number[]>(),
        errorCounts: new Map<string, number>(),
    };

    /**
     * 记录操作性能指标
     */
    private recordPerformanceMetric(operation: string, duration: number, success: boolean): void {
        // 记录操作次数
        const currentCount = this.performanceMetrics.operationCounts.get(operation) || 0;
        this.performanceMetrics.operationCounts.set(operation, currentCount + 1);

        // 记录操作时间
        const times = this.performanceMetrics.operationTimes.get(operation) || [];
        times.push(duration);
        if (times.length > 100) times.shift(); // 保持最近100次记录
        this.performanceMetrics.operationTimes.set(operation, times);

        // 记录错误次数
        if (!success) {
            const errorCount = this.performanceMetrics.errorCounts.get(operation) || 0;
            this.performanceMetrics.errorCounts.set(operation, errorCount + 1);
        }

        // 性能警告
        if (duration > 5000) {
            // 超过5秒
            this.logger.warn(`操作 ${operation} 执行时间过长: ${duration}ms`);
        }
    }

    /**
     * 性能监控装饰器
     */
    private async withPerformanceMonitoring<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
        const startTime = Date.now();
        let success = false;

        try {
            const result = await operation();
            success = true;
            return result;
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = Date.now() - startTime;
            this.recordPerformanceMetric(operationName, duration, success);
        }
    }

    /**
     * 获取性能统计信息
     */
    public getPerformanceStats(): Record<string, any> {
        const stats: Record<string, any> = {};

        for (const [operation, times] of this.performanceMetrics.operationTimes.entries()) {
            if (times.length > 0) {
                const avg = times.reduce((a, b) => a + b, 0) / times.length;
                const max = Math.max(...times);
                const min = Math.min(...times);
                const count = this.performanceMetrics.operationCounts.get(operation) || 0;
                const errors = this.performanceMetrics.errorCounts.get(operation) || 0;

                stats[operation] = {
                    count,
                    errors,
                    errorRate: count > 0 ? ((errors / count) * 100).toFixed(2) + "%" : "0%",
                    avgTime: Math.round(avg),
                    maxTime: max,
                    minTime: min,
                };
            }
        }

        return stats;
    }

    /**
     * 输入验证辅助方法
     */
    private validateEntityId(entityId: string): void {
        if (!entityId || typeof entityId !== "string" || entityId.trim().length === 0) {
            throw new AppError("实体ID不能为空", {
                code: ErrorCodes.VALIDATION.INVALID_INPUT,
                context: { entityId },
            });
        }
    }

    private validateFactContent(content: string): void {
        if (!content || typeof content !== "string" || content.trim().length === 0) {
            throw new AppError("事实内容不能为空", {
                code: ErrorCodes.VALIDATION.INVALID_INPUT,
                context: { content },
            });
        }

        if (content.length > 2000) {
            throw new AppError("事实内容过长，最大长度为2000字符", {
                code: ErrorCodes.VALIDATION.INVALID_INPUT,
                context: { contentLength: content.length },
            });
        }
    }

    private validateSearchQuery(query: string): void {
        if (!query || typeof query !== "string" || query.trim().length === 0) {
            throw new AppError("搜索查询不能为空", {
                code: ErrorCodes.VALIDATION.INVALID_INPUT,
                context: { query },
            });
        }
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

        this.logger.info("服务已启动，开始监听消息。");
    }

    protected async stop(): Promise<void> {
        this.isShuttingDown = true;

        // 清理定时器
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = undefined;
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
        this.operationLocks.clear();
        this.lockTimeouts.forEach((timeout) => clearTimeout(timeout));
        this.lockTimeouts.clear();
        this.retryCounters.clear();
        this.circuitBreakers.clear();

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

            // 执行实体去重（非自动合并模式，只记录）
            const dedupeResult = await this.deduplicateEntities({ autoMerge: false });
            if (dedupeResult.success) {
                this.logger.info("维护任务：实体去重检查完成");
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
            TableName.Entities,
            {
                id: "string(64)",
                type: "string(32)",
                name: "string(255)",
                metadata: "object",
                embedding: "array",
                createdAt: "timestamp",
                updatedAt: "timestamp",
                isDeleted: { type: "boolean", initial: false },
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.Facts,
            {
                id: "string(64)",
                content: "text",
                embedding: "array",
                relatedEntityIds: "array",
                type: "string(32)",
                sourceMessageId: "string(64)",
                salience: "float",
                createdAt: "timestamp",
                lastAccessedAt: "timestamp",
                accessCount: "integer",
                confidence: "float",
                isDeleted: { type: "boolean", initial: false },
                updatedAt: "timestamp",
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.UserProfiles,
            {
                id: "string(64)",
                entityId: "string(64)",
                content: "text",
                embedding: "array",
                confidence: "float",
                supportingFactIds: "array",
                updatedAt: "timestamp",
                createdAt: "timestamp",
                version: "integer",
                salience: "float",
                keyFactsForUpdate: "array",
                isDeleted: { type: "boolean", initial: false },
                tags: "array",
            },
            { primary: "id", unique: [["entityId"]] }
        );
    }

    private registerPromptTemplates() {
        this.promptService.registerTemplate("memory.fact_extraction", loadPrompt("memory/fact_retrieval"));
        /* prettier-ignore */
        this.promptService.registerTemplate("memory.profile_consolidation", loadPrompt("memory/profile_consolidation"));
    }

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
     * 增强的操作锁，支持超时控制、重试机制和熔断器
     * @param lockKey 锁的键
     * @param operation 要执行的操作
     * @param options 执行选项
     * @returns 操作结果
     */
    private async withLock<T>(
        lockKey: string,
        operation: () => Promise<T>,
        options: {
            maxRetries?: number;
            retryDelayMs?: number;
            timeoutMs?: number;
            enableCircuitBreaker?: boolean;
        } = {}
    ): Promise<T> {
        const {
            maxRetries = this.errorHandlingConfig.maxRetries,
            retryDelayMs = this.errorHandlingConfig.retryDelayMs,
            timeoutMs = this.errorHandlingConfig.lockTimeoutMs,
            enableCircuitBreaker = true,
        } = options;

        // 检查熔断器状态
        if (enableCircuitBreaker && this.isCircuitBreakerOpen(lockKey)) {
            throw new AppError(`操作 ${lockKey} 的熔断器已打开，暂时不可用`, {
                code: ErrorCodes.OPERATION.CIRCUIT_BREAKER_OPEN,
                context: { lockKey },
            });
        }

        // 等待现有锁释放（带超时）
        if (this.operationLocks.has(lockKey)) {
            try {
                await this.waitForLockWithTimeout(lockKey, timeoutMs);
            } catch (error) {
                throw new AppError(`等待锁 ${lockKey} 超时`, {
                    code: ErrorCodes.OPERATION.LOCK_TIMEOUT,
                    context: { lockKey, timeoutMs },
                    cause: error,
                });
            }
        }

        // 执行操作（带重试）
        return this.executeWithRetry(lockKey, operation, maxRetries, retryDelayMs, enableCircuitBreaker);
    }

    /**
     * 等待锁释放（带超时）
     */
    private async waitForLockWithTimeout(lockKey: string, timeoutMs: number): Promise<void> {
        const existingLock = this.operationLocks.get(lockKey);
        if (!existingLock) return;

        const timeoutPromise = new Promise<never>((_, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Lock timeout for ${lockKey}`));
            }, timeoutMs);
            this.lockTimeouts.set(lockKey, timeout);
        });

        try {
            await Promise.race([existingLock, timeoutPromise]);
        } finally {
            const timeout = this.lockTimeouts.get(lockKey);
            if (timeout) {
                clearTimeout(timeout);
                this.lockTimeouts.delete(lockKey);
            }
        }
    }

    /**
     * 带重试机制的操作执行
     */
    private async executeWithRetry<T>(
        lockKey: string,
        operation: () => Promise<T>,
        maxRetries: number,
        retryDelayMs: number,
        enableCircuitBreaker: boolean
    ): Promise<T> {
        const operationPromise = this.executeWithTracking(async () => {
            let lastError: Error | undefined;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const result = await operation();

                    // 成功时重置重试计数器和熔断器
                    this.retryCounters.delete(lockKey);
                    if (enableCircuitBreaker) {
                        this.resetCircuitBreaker(lockKey);
                    }

                    return result;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    // 记录重试次数
                    const currentRetries = this.retryCounters.get(lockKey) || 0;
                    this.retryCounters.set(lockKey, currentRetries + 1);

                    // 更新熔断器状态
                    if (enableCircuitBreaker) {
                        this.recordCircuitBreakerFailure(lockKey);
                    }

                    // 如果还有重试机会且不是最后一次尝试，等待后重试
                    if (attempt < maxRetries && !this.isShuttingDown) {
                        this.logger.warn(
                            `操作 ${lockKey} 失败，${retryDelayMs}ms 后重试 (${attempt + 1}/${maxRetries}): ${lastError.message
                            }`
                        );
                        await this.delay(retryDelayMs * Math.pow(2, attempt)); // 指数退避
                        continue;
                    }

                    // 所有重试都失败了
                    this.logger.error(`操作 ${lockKey} 在 ${maxRetries} 次重试后仍然失败: ${lastError.message}`);
                    break;
                }
            }

            throw lastError || new Error(`操作 ${lockKey} 失败`);
        });

        this.operationLocks.set(lockKey, operationPromise);

        try {
            return await operationPromise;
        } finally {
            this.operationLocks.delete(lockKey);
        }
    }

    /**
     * 执行操作并跟踪活跃操作数量
     */
    private async executeWithTracking<T>(operation: () => Promise<T>): Promise<T> {
        if (this.isShuttingDown) {
            throw new AppError("服务正在关闭，无法执行新操作", {
                code: ErrorCodes.OPERATION.SERVICE_SHUTTING_DOWN,
            });
        }

        this.activeOperations++;
        try {
            return await operation();
        } finally {
            this.activeOperations--;
        }
    }

    /**
     * 检查熔断器是否打开
     */
    private isCircuitBreakerOpen(lockKey: string): boolean {
        const breaker = this.circuitBreakers.get(lockKey);
        if (!breaker) return false;

        // 如果熔断器打开且超过重置时间，则重置熔断器
        if (
            breaker.isOpen &&
            Date.now() - breaker.lastFailure.getTime() > this.errorHandlingConfig.circuitBreakerResetMs
        ) {
            this.resetCircuitBreaker(lockKey);
            return false;
        }

        return breaker.isOpen;
    }

    /**
     * 记录熔断器失败
     */
    private recordCircuitBreakerFailure(lockKey: string): void {
        const breaker = this.circuitBreakers.get(lockKey) || { failures: 0, lastFailure: new Date(), isOpen: false };
        breaker.failures++;
        breaker.lastFailure = new Date();

        // 如果失败次数超过阈值，打开熔断器
        if (breaker.failures >= this.errorHandlingConfig.circuitBreakerThreshold) {
            breaker.isOpen = true;
            this.logger.warn(`熔断器 ${lockKey} 已打开，失败次数: ${breaker.failures}`);
        }

        this.circuitBreakers.set(lockKey, breaker);
    }

    /**
     * 重置熔断器
     */
    private resetCircuitBreaker(lockKey: string): void {
        const breaker = this.circuitBreakers.get(lockKey);
        if (breaker) {
            breaker.failures = 0;
            breaker.isOpen = false;
            this.logger.info(`熔断器 ${lockKey} 已重置`);
        }
    }

    /**
     * 延迟工具方法
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 智能获取用户画像相关的事实
     * 支持增量更新和全量更新
     */
    private async getRelevantFactsForProfile(
        entityId: string,
        existingProfile: UserProfile | null,
        forceReconsolidate: boolean
    ): Promise<{ relevantFacts: Fact[]; newFactsOnly: boolean }> {
        const config = this.profileGenerationConfig;

        // 获取所有相关事实
        const allFacts = await this.ctx.database.get(TableName.Facts, {
            relatedEntityIds: { $some: [entityId] },
            isDeleted: false,
            salience: { $gte: config.factRelevanceThreshold },
        });

        if (!existingProfile || forceReconsolidate || !config.enableIncrementalUpdate) {
            // 全量更新：返回所有相关事实
            return { relevantFacts: allFacts, newFactsOnly: false };
        }

        // 增量更新：只返回新的事实
        const existingSupportingFactIds = new Set(existingProfile.supportingFactIds || []);
        const newFacts = allFacts.filter((fact) => !existingSupportingFactIds.has(fact.id));

        // 如果新事实太少，考虑包含一些高权重的旧事实来保持上下文
        if (newFacts.length < config.minFactsForUpdate && allFacts.length > 0) {
            // 选择一些高显著性的旧事实作为上下文
            const contextFacts = allFacts
                .filter((fact) => existingSupportingFactIds.has(fact.id))
                .sort((a, b) => b.salience - a.salience)
                .slice(0, Math.max(2, Math.floor(config.minFactsForUpdate / 2)));

            return {
                relevantFacts: [...newFacts, ...contextFacts],
                newFactsOnly: false,
            };
        }

        return { relevantFacts: newFacts, newFactsOnly: true };
    }

    /**
     * 计算事实在画像生成中的权重
     */
    private calculateFactWeight(fact: Fact, existingProfile: UserProfile | null): number {
        let weight = 1.0;

        // 基于显著性的权重
        weight *= 1 + fact.salience;

        // 基于访问次数的权重
        weight *= Math.min(1 + fact.accessCount * 0.1, 2.0);

        // 如果是关键事实类型，应用配置的权重倍数
        const keyFactTypes = ["preference", "behavioral_pattern", "core_trait"];
        if (keyFactTypes.includes(fact.type)) {
            weight *= this.profileGenerationConfig.keyFactWeight;
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

                    const aPriority = aIsKey + aIsNew + a.salience;
                    const bPriority = bIsKey + bIsNew + b.salience;

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
                const allMemories = [
                    ...facts.map((f) => ({ ...f, memoryType: "fact" })),
                    ...insights.map((i) => ({ ...i, memoryType: "insight" })),
                ];

                // 3. 遍历并存储每一条记忆（无论是事实还是洞察）
                for (const memory of allMemories) {
                    await this.storeMemory(memory);
                }

                this.logger.info(`成功处理并存储了 ${allMemories.length} 条新记忆。`);

                const relatedPersons = new Set<string>();

                // 4. 更新用户画像
                for (const memory of allMemories) {
                    if (memory.relatedEntities && memory.relatedEntities.length > 0) {
                        for (const entity of memory.relatedEntities) {
                            if (entity.type === EntityType.Person) {
                                const person = await this.getOrCreateUserEntity((entity as any)?.metadata?.userId);

                                if (!person.success) {
                                    // this.logger.error(`为用户 ${entity.name} 创建画像时出错: ${person.error}`);
                                    continue;
                                }
                                // 忽略助手自身
                                if (person.data.metadata?.userId === aiIdentity.id) {
                                    continue;
                                }
                                relatedPersons.add(person.data.id);
                            }
                        }
                    }
                }

                await Promise.all([...relatedPersons].map((personId) => this.consolidateProfile(personId)));
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
        const systemPrompt = await this.promptService.render("memory.fact_extraction");

        const userPrompt = await this.promptService.renderRaw(
            "[AI_IDENTITY]\nID: {{aiIdentity.id}} | 昵称: {{aiIdentity.name}}\n\nInput:\n{{ conversationText }}",
            {
                aiIdentity,
                conversationText: chunk,
            }
        );

        const { text } = await this.chatModel.chat({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
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
            // 1. 确保所有相关的实体都已存在于数据库中
            const entityIdSet = new Set<string>();
            if (memoryData.relatedEntities && memoryData.relatedEntities.length > 0) {
                // 顺序执行，避免并发问题
                for (const entity of memoryData.relatedEntities) {
                    /* prettier-ignore */
                    //@ts-ignore
                    const result = await this.addOrGetEntity(entity.name, entity.type || EntityType.Unknown, entity.metadata);
                    if (result.success && result.data) {
                        entityIdSet.add(result.data.id);
                    }
                }
            }

            // 如果没有任何关联实体，这条记忆是无用的，可以跳过
            if (entityIdSet.size === 0) {
                this.logger.warn(`跳过一条没有关联任何实体的记忆: "${memoryData.content}"`);
                return;
            }

            // 2. 组装最终要存入数据库的事实数据
            const factToStore: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount"> = {
                content: memoryData.content,
                relatedEntityIds: Array.from(entityIdSet),
                //@ts-ignore
                type: memoryData.type === "insight" ? "behavioral_pattern" : memoryData.type || "statement",
                salience: memoryData.salience || 0.5,
                sourceMessageId: memoryData.sourceMessageId,
            };

            // 3. 调用服务添加事实，这会处理向量化和数据库写入
            const result = await this.addFact(factToStore);
            if (result.success) {
                const type = memoryData.type === "behavioral_pattern" ? "洞察" : "事实";
                this.logger.debug(`成功存储记忆: [${type}] "${factToStore.content}"`);
            }
        } catch (error) {
            this.logger.error(`存储单条记忆时出错: "${memoryData.content}"`, error);
        }
    }

    // =================================================================================
    // #region IMemoryService 接口实现
    // =================================================================================

    async addOrGetEntity(
        name: string,
        type: EntityType,
        metadata: Record<string, any> = {}
    ): Promise<MemoryOperationResult<Entity>> {
        try {
            // 对于人员类型的实体，如果提供了 userId，优先通过 userId 查找
            if (type === EntityType.Person && metadata.userId) {
                const userEntityResult = await this.getOrCreateUserEntity(metadata.userId, metadata);
                return userEntityResult;
            }

            // 对于其他类型的实体，通过 name 和 type 查找
            const [existingEntity] = await this.ctx.database.get(TableName.Entities, { name, type });
            if (existingEntity) {
                // 如果找到现有实体，更新其元数据（合并新的元数据）
                if (Object.keys(metadata).length > 0) {
                    const updatedMetadata = { ...existingEntity.metadata, ...metadata };
                    await this.ctx.database.set(
                        TableName.Entities,
                        { id: existingEntity.id },
                        {
                            metadata: updatedMetadata,
                            updatedAt: new Date(),
                        }
                    );
                    return { success: true, data: { ...existingEntity, metadata: updatedMetadata } };
                }
                return { success: true, data: existingEntity };
            }

            const newEntity: Entity = {
                id: uuidv4(),
                name,
                type,
                metadata,
                createdAt: new Date(),
            };

            const createdEntity = await this.ctx.database.create(TableName.Entities, newEntity);
            return { success: true, data: createdEntity };
        } catch (error) {
            this.logger.error(`添加或获取实体失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async getOrCreateUserEntity(
        userId: string,
        metadata: Record<string, any> = {}
    ): Promise<MemoryOperationResult<Entity>> {
        const lockKey = `user_entity_${userId}`;

        return this.withLock(lockKey, async () => {
            try {
                // 首先尝试通过 metadata.userId 查找现有实体
                const existingEntities = await this.ctx.database.get(TableName.Entities, {
                    type: EntityType.Person,
                    isDeleted: false,
                });

                const existingEntity = existingEntities.find((entity) => entity.metadata?.userId === userId);

                if (existingEntity) {
                    // 如果找到现有实体，更新其元数据（如果有新信息）
                    if (Object.keys(metadata).length > 0) {
                        const updatedMetadata = { ...existingEntity.metadata, ...metadata };
                        await this.ctx.database.set(
                            TableName.Entities,
                            { id: existingEntity.id },
                            {
                                metadata: updatedMetadata,
                                updatedAt: new Date(),
                            }
                        );
                        return { success: true, data: { ...existingEntity, metadata: updatedMetadata } };
                    }
                    return { success: true, data: existingEntity };
                }

                // 如果没有找到，创建新的用户实体
                const newEntity: Entity = {
                    id: uuidv4(),
                    name: metadata.name || metadata.nick || `${userId}`,
                    type: EntityType.Person,
                    metadata: { ...metadata, userId },
                    createdAt: new Date(),
                };

                const createdEntity = await this.ctx.database.create(TableName.Entities, newEntity);
                return { success: true, data: createdEntity };
            } catch (error) {
                this.logger.error(`获取或创建用户实体失败: ${error.message}`, error);
                return { success: false, error: error.message };
            }
        });
    }

    /**
     * 为实体生成嵌入向量
     * @param entity 实体对象
     * @returns 更新后的实体
     */
    async generateEntityEmbedding(entity: Entity): Promise<MemoryOperationResult<Entity>> {
        try {
            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用" };
            }

            // 构建用于嵌入的文本内容
            let embeddingText = entity.name;

            // 对于人员类型，添加更多上下文信息
            if (entity.type === EntityType.Person && entity.metadata) {
                const contextParts = [entity.name];
                if (entity.metadata.userId) contextParts.push(`用户ID: ${entity.metadata.userId}`);
                if (entity.metadata.platform) contextParts.push(`平台: ${entity.metadata.platform}`);
                if (entity.metadata.nick && entity.metadata.nick !== entity.name) {
                    contextParts.push(`昵称: ${entity.metadata.nick}`);
                }
                embeddingText = contextParts.join(" ");
            }

            const embedding = await this.embeddingModel.embed(embeddingText).then((res) => res.embedding);

            // 更新数据库中的实体
            await this.ctx.database.set(
                TableName.Entities,
                { id: entity.id },
                {
                    embedding,
                    updatedAt: new Date(),
                }
            );

            const updatedEntity = { ...entity, embedding, updatedAt: new Date() };
            return { success: true, data: updatedEntity };
        } catch (error) {
            this.logger.error(`生成实体嵌入向量失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async findSimilarEntities(
        entity: Entity,
        options: EntityMergeOptions = {}
    ): Promise<MemoryOperationResult<Entity[]>> {
        try {
            const { similarityThreshold = 0.8 } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法进行相似度搜索" };
            }

            // 如果实体没有嵌入向量，先生成一个
            let targetEntity = entity;
            if (!entity.embedding) {
                const embeddingResult = await this.generateEntityEmbedding(entity);
                if (!embeddingResult.success || !embeddingResult.data) {
                    return { success: false, error: "无法为目标实体生成嵌入向量" };
                }
                targetEntity = embeddingResult.data;
            }

            // 获取同类型的所有实体
            const sameTypeEntities = await this.ctx.database.get(TableName.Entities, {
                type: entity.type,
                id: { $ne: entity.id }, // 排除自己
                isDeleted: { $ne: true },
            });

            const similarEntities: Entity[] = [];

            for (const otherEntity of sameTypeEntities) {
                // 如果其他实体没有嵌入向量，为其生成一个
                let otherEntityWithEmbedding = otherEntity;
                if (!otherEntity.embedding) {
                    const embeddingResult = await this.generateEntityEmbedding(otherEntity);
                    if (embeddingResult.success && embeddingResult.data) {
                        otherEntityWithEmbedding = embeddingResult.data;
                    } else {
                        continue; // 跳过无法生成嵌入向量的实体
                    }
                }

                const similarity = cosineSimilarity(targetEntity.embedding!, otherEntityWithEmbedding.embedding!);
                if (similarity >= similarityThreshold) {
                    similarEntities.push({ ...otherEntityWithEmbedding, similarity } as Entity & {
                        similarity: number;
                    });
                }
            }

            // 按相似度降序排序
            similarEntities.sort((a, b) => (b as any).similarity - (a as any).similarity);

            return { success: true, data: similarEntities };
        } catch (error) {
            this.logger.error(`查找相似实体失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async mergeEntities(sourceEntityId: string, targetEntityId: string): Promise<MemoryOperationResult<Entity>> {
        try {
            // 获取源实体和目标实体
            const [sourceEntity] = await this.ctx.database.get(TableName.Entities, { id: sourceEntityId });
            const [targetEntity] = await this.ctx.database.get(TableName.Entities, { id: targetEntityId });

            if (!sourceEntity || !targetEntity) {
                return { success: false, error: "源实体或目标实体不存在" };
            }

            // 更新所有引用源实体的事实
            const factsToUpdate = await this.ctx.database.get(TableName.Facts, {
                relatedEntityIds: { $some: [sourceEntityId] },
            });

            for (const fact of factsToUpdate) {
                const updatedEntityIds = fact.relatedEntityIds.map((id) =>
                    id === sourceEntityId ? targetEntityId : id
                );
                await this.ctx.database.set(
                    TableName.Facts,
                    { id: fact.id },
                    {
                        relatedEntityIds: updatedEntityIds,
                    }
                );
            }

            // 合并元数据
            const mergedMetadata = { ...sourceEntity.metadata, ...targetEntity.metadata };
            await this.ctx.database.set(
                TableName.Entities,
                { id: targetEntityId },
                {
                    metadata: mergedMetadata,
                    updatedAt: new Date(),
                }
            );

            // 软删除源实体
            await this.ctx.database.set(
                TableName.Entities,
                { id: sourceEntityId },
                {
                    isDeleted: true,
                    updatedAt: new Date(),
                }
            );

            const [updatedEntity] = await this.ctx.database.get(TableName.Entities, { id: targetEntityId });
            return { success: true, data: updatedEntity };
        } catch (error) {
            this.logger.error(`合并实体失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async addFact(
        factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">
    ): Promise<MemoryOperationResult<Fact>> {
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

    async searchFacts(query: string, options: SearchOptions = {}): Promise<MemoryOperationResult<Fact[]>> {
        try {
            const {
                entityIds = [],
                limit = 10,
                minSalience = 0,
                minSimilarity = 0.3,
                includeDeleted = false,
            } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索。" };
            }

            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            // 数据库查询条件
            const dbQuery: any = {
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            if (entityIds.length > 0) {
                dbQuery.relatedEntityIds = { $some: entityIds };
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

            // 更新访问信息（异步，不等待结果）
            const topFacts = factsWithSimilarity.slice(0, limit);
            topFacts.forEach((fact) => {
                this.updateFactAccess(fact.id).catch((error) => this.logger.warn(`更新事实访问信息失败: ${error}`));
            });

            return { success: true, data: topFacts };
        } catch (error) {
            this.logger.error(`搜索事实失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    async getUserProfile(entityId: string): Promise<MemoryOperationResult<UserProfile | null>> {
        try {
            const [profile] = await this.ctx.database.get(TableName.UserProfiles, {
                entityId,
                isDeleted: { $ne: true },
            });
            return { success: true, data: profile || null };
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
            const {
                entityIds = [],
                limit = 10,
                minSalience = 0,
                minSimilarity = 0.3,
                includeDeleted = false,
            } = options;

            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用，无法执行语义搜索。" };
            }

            const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

            // 数据库查询条件
            const dbQuery: Query<UserProfile> = {
                salience: { $gte: minSalience },
                ...(includeDeleted ? {} : { isDeleted: { $ne: true } }),
            };

            if (entityIds.length > 0) {
                dbQuery.entityId = { $in: entityIds };
            }

            // **注意：这是一个模拟向量搜索的实现！**
            // 在生产环境中，当画像数量巨大时，此方法效率低下。
            // 强烈建议使用支持原生向量搜索的数据库 (e.g., PostgreSQL + pgvector, Qdrant, Milvus)。
            this.logger.info("正在执行模拟向量搜索。对于大数据集，这可能很慢。");

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
    public async consolidateProfile(entityId: string, options: ProfileConsolidationOptions = {}): Promise<MemoryOperationResult<UserProfile | null>> {
        // 输入验证
        this.validateEntityId(entityId);

        const lockKey = `profile_consolidation_${entityId}`;

        return this.withLock(lockKey, async () => {
            return this.withPerformanceMonitoring('consolidateProfile', async () => {
                try {
                    // 使用配置中的默认值
                    const {
                        forceReconsolidate = false,
                        minFactsThreshold = this.profileGenerationConfig.minFactsForUpdate,
                        confidenceThreshold = this.profileGenerationConfig.confidenceThreshold,
                    } = options;

                    // 1. 获取实体信息
                    const entity = await this.ctx.database
                        .get(TableName.Entities, {
                            id: entityId,
                            isDeleted: false,
                        })
                        .then((res) => res[0]);

                    if (!entity || entity.type !== EntityType.Person) {
                        return { success: false, error: "实体不存在或不是人员类型" };
                    }

                    // 2. 获取现有的 Profile
                    const existingProfile = await this.ctx.database
                        .get(TableName.UserProfiles, { entityId })
                        .then((res) => res[0]);

                    // 3. 检查更新频率限制
                    if (existingProfile && !forceReconsolidate) {
                        const hoursSinceLastUpdate = (Date.now() - existingProfile.updatedAt.getTime()) / (1000 * 60 * 60);
                        if (hoursSinceLastUpdate < this.profileGenerationConfig.updateIntervalHours) {
                            const userId = entity.metadata?.userId || entity.name;
                            this.logger.info(`用户 ${userId} 的画像更新过于频繁，跳过。距离上次更新仅 ${hoursSinceLastUpdate.toFixed(1)} 小时`);
                            return { success: true, data: existingProfile };
                        }
                    }

                    // 4. 智能获取相关事实（增量更新或全量更新）
                    const { relevantFacts, newFactsOnly } = await this.getRelevantFactsForProfile(entityId, existingProfile, forceReconsolidate);

                    if (relevantFacts.length < minFactsThreshold && !forceReconsolidate) {
                        const userId = entity.metadata?.userId || entity.name;
                        this.logger.info(`用户 ${userId} 没有足够的相关事实需要整合，跳过。当前事实数: ${relevantFacts.length}`);
                        return { success: true, data: existingProfile };
                    }

                    // 5. 构建 Prompt 输入，使用用户ID而不是用户名
                    const userId = entity.metadata?.userId || entity.name;
                    const userName = entity.name || `User_${userId}`;

                    // 根据事实权重调整输入
                    const weightedFacts = relevantFacts.map(fact => {
                        const weight = this.calculateFactWeight(fact, existingProfile);
                        const prefix = weight > 1 ? `[重要] ` : '';
                        return `${prefix}[${fact.type}] ${fact.content}`;
                    });

                    const inputForLLM = {
                        userId: userId,
                        userName: userName,
                        existingProfile: existingProfile?.content || "This is a new profile for this user.",
                        isIncrementalUpdate: newFactsOnly,
                        factCount: relevantFacts.length,
                        newFactsAndInsights: weightedFacts,
                    };

                    // 将 inputForLLM 格式化并填入 PROFILE_CONSOLIDATION_PROMPT 模板
                    const systemPrompt = await this.promptService.render("memory.profile_consolidation");

                    const userPrompt = await this.promptService.renderRaw(`Input:
Current Date: {{date.now}}
User ID: "{{userId}}"
User Name: "{{userName}}"
Existing Profile: "{{existingProfile}}"
New Facts & Insights:
{{#newFactsAndInsights}}
  {{.}}
{{/newFactsAndInsights}}`, inputForLLM);

                    // 5. 调用 LLM
                    const response = await this.chatModel.chat({
                        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
                        temperature: 0.2,
                    });

                    const parser = new JsonParser<any>();
                    const result = parser.parse(response.text);

                    if (result.error) {
                        this.logger.error(`整合用户画像时出错: ${result.error}`);
                        return { success: false, error: `LLM解析失败: ${result.error}` };
                    }

                    const { profile_content, confidence_score, key_facts_for_update } = result.data;

                    // 检查置信度阈值
                    if (confidence_score < confidenceThreshold) {
                        this.logger.warn(`用户 ${userId} 的画像置信度过低 (${confidence_score})，跳过更新。`);
                        return { success: true, data: existingProfile };
                    }

                    // 6. 智能更新支持事实列表
                    const updatedSupportingFactIds = this.updateSupportingFactIds(
                        existingProfile?.supportingFactIds || [],
                        relevantFacts,
                        key_facts_for_update,
                        newFactsOnly
                    );

                    // 7. 更新数据库
                    const updatedProfileData = {
                        entityId: entityId,
                        content: profile_content,
                        embedding: await this.embeddingModel.embed(profile_content).then((res) => res.embedding),
                        confidence: confidence_score,
                        supportingFactIds: updatedSupportingFactIds,
                        updatedAt: new Date(),
                        version: (existingProfile?.version || 0) + 1,
                        keyFactsForUpdate: key_facts_for_update || [], // 保存关键事实用于下次增量更新
                    };

                    // 使用 upsert 逻辑：如果profile存在则更新，不存在则创建
                    let updatedProfile: UserProfile;
                    if (existingProfile) {
                        await this.ctx.database.set(TableName.UserProfiles, { id: existingProfile.id }, updatedProfileData);
                        updatedProfile = { ...existingProfile, ...updatedProfileData };
                    } else {
                        updatedProfile = await this.ctx.database.create(TableName.UserProfiles, {
                            id: uuidv4(),
                            ...updatedProfileData,
                            createdAt: new Date(),
                        });
                    }

                    this.logger.info(`成功为用户 ${userId} 整合并更新了人物画像。`);
                    return { success: true, data: updatedProfile };
                } catch (error) {
                    this.logger.error(`整合用户画像失败: ${error.message}`);
                    return { success: false, error: error.message };
                }
            });
        });
    }

    async decayAndForget(): Promise<MemoryOperationResult<{ removedCount: number }>> {
        const lockKey = "decay_and_forget";

        return this.withLock(lockKey, async () => {
            try {
                this.logger.info("开始执行记忆衰减与遗忘任务...");
                const { stalenessDays, salienceThreshold, accessCountThreshold } = this.config.forgetting;

                const stalenessDate = new Date();
                stalenessDate.setDate(stalenessDate.getDate() - stalenessDays);

                const forgettableFacts = await this.ctx.database.get(TableName.Facts, {
                    lastAccessedAt: { $lt: stalenessDate },
                    salience: { $lt: salienceThreshold },
                    accessCount: { $lt: accessCountThreshold },
                    isDeleted: { $ne: true },
                });

                if (forgettableFacts.length > 0) {
                    // 批量处理，避免一次性操作过多数据
                    const batchSize = 100;
                    let removedCount = 0;

                    for (let i = 0; i < forgettableFacts.length; i += batchSize) {
                        const batch = forgettableFacts.slice(i, i + batchSize);
                        const idsToRemove = batch.map((fact) => fact.id);

                        try {
                            await this.ctx.database.set(
                                TableName.Facts,
                                { id: { $in: idsToRemove } },
                                { isDeleted: true, updatedAt: new Date() }
                            );
                            removedCount += idsToRemove.length;
                        } catch (batchError) {
                            this.logger.error(`批量删除事实失败: ${batchError.message}`, batchError);
                            // 继续处理下一批，不中断整个过程
                        }
                    }

                    this.logger.info(`已遗忘 ${removedCount} 条陈旧且不重要的事实。`);
                    return { success: true, data: { removedCount } };
                } else {
                    this.logger.info("没有需要遗忘的事实。");
                    return { success: true, data: { removedCount: 0 } };
                }
            } catch (error) {
                this.logger.error(`记忆衰减与遗忘失败: ${error.message}`, error);
                return { success: false, error: error.message };
            }
        });
    }

    /**
     * 数据一致性检查和修复
     * @returns 检查结果
     */
    /* prettier-ignore */
    async performDataConsistencyCheck(): Promise<MemoryOperationResult<{
        orphanedFacts: number;
        missingEmbeddings: number;
        fixedIssues: number;
    }>> {
        try {
            this.logger.info("开始执行数据一致性检查...");

            let orphanedFacts = 0;
            let missingEmbeddings = 0;
            let fixedIssues = 0;

            // 1. 检查孤立的事实（引用不存在的实体）
            const allFacts = await this.ctx.database.get(TableName.Facts, { isDeleted: { $ne: true } });
            const allEntityIds = new Set(
                (await this.ctx.database.get(TableName.Entities, { isDeleted: { $ne: true } })).map((e) => e.id)
            );

            for (const fact of allFacts) {
                const hasValidEntities = fact.relatedEntityIds.some((entityId) => allEntityIds.has(entityId));
                if (!hasValidEntities) {
                    orphanedFacts++;
                    // 软删除孤立的事实
                    await this.ctx.database.set(
                        TableName.Facts,
                        { id: fact.id },
                        {
                            isDeleted: true,
                            updatedAt: new Date(),
                        }
                    );
                    fixedIssues++;
                }
            }

            // 2. 检查缺失嵌入向量的实体
            const entitiesWithoutEmbedding = await this.ctx.database.get(TableName.Entities, {
                embedding: null,
                isDeleted: { $ne: true },
            });

            missingEmbeddings = entitiesWithoutEmbedding.length;

            // 为缺失嵌入向量的实体生成嵌入向量
            if (missingEmbeddings > 0) {
                const embeddingResult = await this.batchGenerateEntityEmbeddings(entitiesWithoutEmbedding);
                if (embeddingResult.success && embeddingResult.data) {
                    fixedIssues += embeddingResult.data.processedCount;
                }
            }

            this.logger.info(
                `数据一致性检查完成: 孤立事实 ${orphanedFacts}, 缺失嵌入 ${missingEmbeddings}, 已修复 ${fixedIssues}`
            );

            return {
                success: true,
                data: { orphanedFacts, missingEmbeddings, fixedIssues },
            };
        } catch (error) {
            this.logger.error(`数据一致性检查失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 批量为实体生成嵌入向量
     * @param entities 实体列表
     * @returns 处理结果
     */
    /* prettier-ignore */
    async batchGenerateEntityEmbeddings(entities: Entity[]): Promise<MemoryOperationResult<{ processedCount: number }>> {
        try {
            if (!this.embeddingModel) {
                return { success: false, error: "嵌入模型不可用" };
            }

            let processedCount = 0;
            const batchSize = 10; // 批处理大小，避免过载

            for (let i = 0; i < entities.length; i += batchSize) {
                const batch = entities.slice(i, i + batchSize);
                const promises = batch
                    .filter((entity) => !entity.embedding) // 只处理没有嵌入向量的实体
                    .map((entity) => this.generateEntityEmbedding(entity));

                const results = await Promise.all(promises);
                processedCount += results.filter((result) => result.success).length;

                // 添加小延迟以避免API限制
                if (i + batchSize < entities.length) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }

            return { success: true, data: { processedCount } };
        } catch (error) {
            this.logger.error(`批量生成实体嵌入向量失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }

    /* prettier-ignore */
    async deduplicateEntities(options: EntityMergeOptions = {}): Promise<MemoryOperationResult<{ mergedCount: number }>> {
        try {
            const { similarityThreshold = 0.9, autoMerge = false, mergeStrategy = "keep_oldest" } = options;
            let mergedCount = 0;

            this.logger.info("开始实体去重处理...");

            // 获取所有实体
            const allEntities = await this.ctx.database.get(TableName.Entities, {
                isDeleted: { $ne: true },
            });

            this.logger.info(`找到 ${allEntities.length} 个实体需要处理`);

            // 首先为所有实体生成嵌入向量（如果还没有的话）
            const embeddingResult = await this.batchGenerateEntityEmbeddings(allEntities);
            if (embeddingResult.success && embeddingResult.data) {
                this.logger.info(`为 ${embeddingResult.data.processedCount} 个实体生成了嵌入向量`);
            }

            // 按类型分组处理
            const entitiesByType = allEntities.reduce((acc, entity) => {
                if (!acc[entity.type]) acc[entity.type] = [];
                acc[entity.type].push(entity);
                return acc;
            }, {} as Record<string, Entity[]>);

            for (const [type, entities] of Object.entries(entitiesByType)) {
                if (entities.length < 2) continue;

                this.logger.info(`处理 ${type} 类型的 ${entities.length} 个实体`);

                // 使用集合来跟踪已处理的实体，避免重复处理
                const processedEntityIds = new Set<string>();

                // 对于每个实体，查找相似的实体
                for (let i = 0; i < entities.length; i++) {
                    const entity = entities[i];
                    if (entity.isDeleted || processedEntityIds.has(entity.id)) continue;

                    const similarResult = await this.findSimilarEntities(entity, { similarityThreshold });
                    if (!similarResult.success || !similarResult.data || similarResult.data.length === 0) {
                        continue;
                    }

                    // 找到相似实体
                    const similarEntities = similarResult.data.filter(
                        (e) => !e.isDeleted && !processedEntityIds.has(e.id)
                    );

                    if (similarEntities.length === 0) continue;

                    this.logger.info(`实体 "${entity.name}" 找到 ${similarEntities.length} 个相似实体`);

                    // 如果启用自动合并，则合并相似实体
                    if (autoMerge) {
                        // 根据合并策略选择目标实体
                        let targetEntity = entity;
                        if (mergeStrategy === "keep_oldest") {
                            const allCandidates = [entity, ...similarEntities];
                            targetEntity = allCandidates.reduce((oldest, current) =>
                                current.createdAt < oldest.createdAt ? current : oldest
                            );
                        }

                        // 合并所有相似实体到目标实体
                        const entitiesToMerge = [entity, ...similarEntities].filter((e) => e.id !== targetEntity.id);

                        for (const entityToMerge of entitiesToMerge) {
                            const mergeResult = await this.mergeEntities(entityToMerge.id, targetEntity.id);
                            if (mergeResult.success) {
                                mergedCount++;
                                processedEntityIds.add(entityToMerge.id);
                                this.logger.info(`已合并实体: ${entityToMerge.name} -> ${targetEntity.name}`);
                            }
                        }

                        processedEntityIds.add(targetEntity.id);
                    } else {
                        // 如果不自动合并，只记录发现的重复实体
                        this.logger.info(
                            `发现重复实体但未自动合并: ${entity.name} 与 ${similarEntities
                                .map((e) => e.name)
                                .join(", ")}`
                        );
                    }
                }
            }

            this.logger.info(`实体去重完成，共合并了 ${mergedCount} 个实体`);
            return { success: true, data: { mergedCount } };
        } catch (error) {
            this.logger.error(`实体去重失败: ${error.message}`, error);
            return { success: false, error: error.message };
        }
    }
}
