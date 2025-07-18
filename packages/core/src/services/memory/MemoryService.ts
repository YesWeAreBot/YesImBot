import { Context, Service, Session, Time } from "koishi";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";

import { IChatModel, IEmbedModel, TaskType } from "@/services/model";
import { loadPrompt, loadTemplate, PromptService } from "@/services/prompt";
import { Services, TableName } from "@/services/types";
import { cosineSimilarity, formatDate, JsonParser } from "@/shared/utils";
import { MemoryConfig } from "./config";
import { Entity, EntityType, ExtractedFact, Fact, MemoryBlockData, UserMessageBatch, UserProfile } from "./types";
import { MemoryBlock } from "./MemoryBlock";
import { AppError, ErrorCodes } from "@/shared/errors";

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

export interface IMemoryService {
    addOrGetEntity(name: string, type: EntityType, metadata?: Record<string, any>): Promise<Entity>;
    addFact(factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">): Promise<Fact>;
    searchFacts(
        query: string,
        options?: { entityIds?: string[]; limit?: number; minSalience?: number }
    ): Promise<Fact[]>;
    getUserProfile(entityId: string): Promise<UserProfile | null>;
    consolidateProfile(entityId: string): Promise<UserProfile | null>;
    decayAndForget(): Promise<void>;
}

export class MemoryService extends Service<MemoryConfig> implements IMemoryService {
    static readonly inject = [Services.Logger, Services.Prompt, Services.Model, "database"];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    // private readonly logger: Logger;
    private readonly promptService: PromptService;
    private readonly chatModel: IChatModel;
    private readonly embeddingModel: IEmbedModel;
    private readonly jsonParser = new JsonParser<{ facts: ExtractedFact[] }>();

    private userMessageBatches: Map<string, UserMessageBatch> = new Map();
    private batchProcessingTimer: NodeJS.Timeout | null = null;

    constructor(ctx: Context, config: MemoryConfig) {
        super(ctx, Services.Memory, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[MemoryService]");
        this.promptService = ctx[Services.Prompt];

        // 从模型服务获取所需的模型实例
        this.chatModel = this.ctx[Services.Model].useChatGroup(TaskType.Memory)?.current;
        this.embeddingModel = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding)?.current;

        if (!this.chatModel || !this.embeddingModel) {
            this.logger.warn("聊天模型或嵌入模型不可用，记忆服务功能将受限。");
        }
    }

    protected async start(): Promise<void> {
        this.registerDatabaseModels();
        this.registerPromptTemplates();
        await this.discoverAndLoadCoreMemoryBlocks();

        // 监听消息事件以收集记忆素材
        this.ctx.on("worldstate:segment-updated", (session) => {
            if (session.author && !session.author.isBot) {
                this.addMessageToBatch(session);
            }
        });

        // 设置定时遗忘任务
        const forgetInterval = this.config.forgetting.checkIntervalHours * Time.hour;
        this.ctx.setInterval(() => this.decayAndForget(), forgetInterval);

        this.logger.info("服务已启动，开始监听消息。");
    }

    protected async stop(): Promise<void> {
        if (this.batchProcessingTimer) {
            clearTimeout(this.batchProcessingTimer);
        }
        await this.processAllBatches(); // 停止服务前处理所有待处理的消息
        this.logger.info("服务已停止。");
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
                createdAt: "timestamp",
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
            },
            { primary: "id", unique: [["entityId"]] }
        );
    }

    private registerPromptTemplates() {
        this.promptService.registerTemplate("memory.fact_extraction", loadPrompt("fact_retrieval"));
        this.promptService.registerTemplate("memory.profile_consolidation", loadTemplate("profile_consolidation"));
    }

    // public async getMemoryDataForRendering(): Promise<MemoryData> {
    //     return {
    //         lastModified: this.lastModified.toISOString(),
    //         memoryBlocks: Array.from(this.coreMemoryBlocks.values()).map((block) => ({
    //             title: block.title,
    //             label: block.label,
    //             limit: block.limit,
    //             description: block.description,
    //             content: block.content as string[],
    //         })),
    //         archivalCount: await this.archivalStore.count(),
    //     };
    // }

    get blocks(): Map<string, MemoryBlock> {
        return this.coreMemoryBlocks;
    }

    public async getMemoryBlocksForRendering(): Promise<MemoryBlockData[]> {
        return Array.from(this.coreMemoryBlocks.values()).map((block) => ({
            title: block.title,
            label: block.label,
            limit: block.limit,
            description: block.description,
            content: block.content as string[],
        }));
    }

    public getCoreMemoryBlock(label: string): MemoryBlock | undefined {
        return this.coreMemoryBlocks.get(label);
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
    private getCoreMemoryBlockOrThrow(label: string): MemoryBlock {
        const block = this.coreMemoryBlocks.get(label);
        if (!block) {
            const available = Array.from(this.coreMemoryBlocks.keys()).join(", ") || "None";
            this.logger.error(`核心记忆块 "${label}" 不存在。可用的有: [${available}]`);
            throw new AppError(`核心记忆块 "${label}" 不存在`, {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "MemoryBlock", resourceId: label, available },
            });
        }
        return block;
    }

    public addMessageToBatch(session: Session): void {
        const uid = session.uid;
        if (!this.userMessageBatches.has(uid)) {
            this.userMessageBatches.set(uid, {
                userId: session.author.id,
                userName: session.author.name,
                messages: [],
                lastMessageTimestamp: 0,
            });
        }

        const currentBatch = this.userMessageBatches.get(uid)!;
        currentBatch.messages.push({ id: session.messageId, text: session.content, timestamp: session.timestamp });
        currentBatch.lastMessageTimestamp = Date.now();

        // 如果消息数量达到上限，立即处理该用户的批次
        if (currentBatch.messages.length >= this.config.batching.maxSize) {
            /* prettier-ignore */
            this.logger.info(`用户 ${currentBatch.userName} 的消息达到批处理上限 (${this.config.batching.maxSize})，立即处理...`);

            // 关键步骤：在处理前，将该用户的批次从主映射中移除！
            this.userMessageBatches.delete(uid);

            // 将刚刚移除的批次对象传递给处理函数
            // 我们不在此处 await，让它在后台异步执行，不阻塞当前消息流
            this.processBatchForUser(currentBatch);
        } else {
            // 只有未达到上限时，才需要重置（或启动）定时器来处理未来的批次
            this.resetBatchProcessingTimer();
        }
    }

    private resetBatchProcessingTimer(): void {
        if (this.batchProcessingTimer) {
            clearTimeout(this.batchProcessingTimer);
        }
        this.batchProcessingTimer = setTimeout(() => this.processAllBatches(), this.config.batching.maxWaitTime * 1000);
    }

    private async processBatchForUser(userBatch: UserMessageBatch): Promise<void> {
        if (!userBatch || userBatch.messages.length === 0) {
            return;
        }

        this.logger.info(`正在为用户 ${userBatch.userName} 处理 ${userBatch.messages.length} 条消息...`);

        try {
            const extractedFacts = await this.extractFactsFromBatch(userBatch);
            this.logger.info(`从 ${userBatch.userName} 的消息中提取到 ${extractedFacts.length} 条事实。`);

            if (!extractedFacts || extractedFacts.length === 0) {
                return; // 没有提取到事实，直接返回
            }

            // 1. 将消息发送者本人首先处理为一个实体，这是所有事实都必然关联的实体。
            //    这是一个优化，避免在循环中重复获取作者实体。
            const authorEntity = await this.addOrGetEntity(
                userBatch.userName,
                EntityType.Person,
                { imUserId: userBatch.userId } // 将平台用户ID存入元数据
            );

            // 2. 遍历所有提取出的事实，并逐一存入数据库
            for (const extractedFact of extractedFacts) {
                try {
                    // 使用 Set 来确保每个实体ID只被记录一次
                    const entityIdSet = new Set<string>();
                    entityIdSet.add(authorEntity.id);

                    // 3. 并行处理事实中提到的所有相关实体
                    if (extractedFact.relatedEntities && extractedFact.relatedEntities.length > 0) {
                        const relatedEntityPromises = extractedFact.relatedEntities.map((e) =>
                            this.addOrGetEntity(e.name, e.type || EntityType.Unknown)
                        );
                        const relatedEntities = await Promise.all(relatedEntityPromises);
                        relatedEntities.forEach((entity) => entityIdSet.add(entity.id));
                    }

                    // 4. 组装最终要存入数据库的事实数据
                    const factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount"> = {
                        content: extractedFact.content,
                        relatedEntityIds: Array.from(entityIdSet), // 从 Set 转换为数组
                        type: extractedFact.type,
                        salience: extractedFact.salience,
                        // 将事实与批次中的最后一条消息关联，便于追溯
                        sourceMessageId: userBatch.messages[userBatch.messages.length - 1]?.id,
                    };

                    // 5. 调用服务自身的方法来添加事实，该方法会处理向量化和数据库写入
                    await this.addFact(factData);
                    this.logger.debug(`成功存储事实: "${factData.content}"`);
                } catch (factError) {
                    this.logger.error(`存储单条事实时出错: "${extractedFact.content}"`, factError);
                    // 继续处理下一条事实，不中断整个批次
                }
            }
        } catch (batchError) {
            this.logger.error(`处理用户 ${userBatch.userName} 的消息批次时出错:`, batchError);
        }
    }

    public async processAllBatches(): Promise<void> {
        if (this.userMessageBatches.size === 0) return;

        this.logger.info(`定时器触发，开始处理 ${this.userMessageBatches.size} 个用户的消息批次...`);

        const batchSnapshot = new Map(this.userMessageBatches);
        this.userMessageBatches.clear(); // 在这里清空是安全的，因为快照已经包含了所有数据

        // 遍历快照的 VALUES (UserMessageBatch 对象)，而不是 KEYS
        const processingTasks = Array.from(batchSnapshot.values()).map((batch) => this.processBatchForUser(batch));
        await Promise.all(processingTasks);
        this.logger.info("所有批处理任务已完成。");
    }

    private async extractFactsFromBatch(batch: UserMessageBatch): Promise<ExtractedFact[]> {
        if (batch.messages.length === 0) {
            return [];
        }

        const conversation = batch.messages.map((m) => `[${m.id}|${formatDate(m.timestamp, "HH:mm:ss")}|${batch.userName}(${batch.userId})] ${m.text}`).join("\n");

        const systemPrompt = await this.promptService.render("memory.fact_extraction", { userName: batch.userName });

        const userPrompt = await this.promptService.renderRaw(`Input:\n{{conversation}}`, { conversation });

        try {
            const response = await this.chatModel.chat([
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ]);

            const parsedResponse = this.jsonParser.parse(response.text);

            if (parsedResponse.error) {
                console.warn("Error parsing LLM response:", parsedResponse.error);
                return [];
            }

            console.log("LLM response:", parsedResponse.data);

            if (parsedResponse && Array.isArray(parsedResponse.data.facts)) {
                return parsedResponse.data.facts as ExtractedFact[];
            }
            console.warn('LLM did not return a valid "facts" array:', parsedResponse);
            return [];
        } catch (error) {
            console.error("Error during fact extraction from LLM:", error);
            return [];
        }
    }

    // --- IMemoryService 接口实现 ---

    async addOrGetEntity(name: string, type: EntityType, metadata: Record<string, any> = {}): Promise<Entity> {
        const [existingEntity] = await this.ctx.database.get(TableName.Entities, { name, type });
        if (existingEntity) {
            return existingEntity;
        }

        const newEntity: Entity = {
            id: `ent_${uuidv4()}`,
            name,
            type,
            metadata,
            createdAt: new Date(),
        };

        return this.ctx.database.create(TableName.Entities, newEntity);
    }

    /* prettier-ignore */
    async addFact(factData: Omit<Fact, "id" | "embedding" | "createdAt" | "lastAccessedAt" | "accessCount">): Promise<Fact> {
        if (!this.embeddingModel) throw new Error("嵌入模型不可用，无法创建事实。");

        const embedding = await this.embeddingModel.embed(factData.content).then((res) => res.embedding);

        const newFact: Fact = {
            ...factData,
            id: `fact_${uuidv4()}`,
            embedding,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            accessCount: 0,
        };

        return this.ctx.database.create(TableName.Facts, newFact);
    }

    async searchFacts(
        query: string,
        options: { entityIds?: string[]; limit?: number; minSalience?: number } = {}
    ): Promise<Fact[]> {
        const { entityIds = [], limit = 10, minSalience = 0 } = options;
        if (!this.embeddingModel) {
            this.logger.warn("嵌入模型不可用，无法执行语义搜索。");
            return [];
        }

        const queryEmbedding = await this.embeddingModel.embed(query).then((res) => res.embedding);

        // 数据库查询条件
        const dbQuery: any = { salience: { $gte: minSalience } };
        if (entityIds.length > 0) {
            dbQuery.relatedEntityIds = { $some: entityIds };
        }

        // **注意：这是一个模拟向量搜索的实现！**
        // 在生产环境中，当事实数量巨大时，此方法效率低下。
        // 强烈建议使用支持原生向量搜索的数据库 (e.g., PostgreSQL + pgvector, Qdrant, Milvus)。
        this.logger.info("正在执行模拟向量搜索。对于大数据集，这可能很慢。");

        const allFacts = await this.ctx.database.get(TableName.Facts, dbQuery);

        if (allFacts.length === 0) return [];

        // 在内存中计算相似度
        /* prettier-ignore */
        const factsWithSimilarity = allFacts.map((fact) => ({ ...fact, similarity: cosineSimilarity(queryEmbedding, fact.embedding) }));

        // 按相似度降序排序
        factsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        // 返回前 N 个结果
        return factsWithSimilarity.slice(0, limit);
    }

    async getUserProfile(entityId: string): Promise<UserProfile | null> {
        const [profile] = await this.ctx.database.get(TableName.UserProfiles, { entityId });
        return profile || null;
    }

    async consolidateProfile(entityId: string): Promise<UserProfile | null> {
        if (!this.chatModel || !this.embeddingModel) {
            this.logger.warn("模型不可用，无法进行画像提炼。");
            return null;
        }

        const existingProfile = await this.getUserProfile(entityId);

        // 查找尚未被用于生成当前画像的、与该实体相关的新事实
        const newFactsQuery: any = { relatedEntityIds: { $contains: entityId } };
        if (existingProfile) {
            newFactsQuery.id = { $nin: existingProfile.supportingFactIds };
        }
        const newFacts = await this.ctx.database.get(TableName.Facts, newFactsQuery, {
            limit: 20,
            sort: { createdAt: "desc" },
        });

        if (newFacts.length === 0) {
            this.logger.info(`实体 ${entityId} 没有新的事实来更新画像。`);
            return existingProfile;
        }

        const consolidationPrompt = await this.promptService.render("memory.profile_consolidation", {
            existingProfile: existingProfile ? JSON.stringify(existingProfile, null, 2) : "无 (这是一个新的人物画像)",
            newFacts: newFacts.map((f) => `- ${f.content} (重要性: ${f.salience.toFixed(2)})`).join("\n"),
        });

        // LLM调用
        const response = await this.chatModel.chat([{ role: "user", content: consolidationPrompt }]);

        // 解析LLM响应
        const parser = new JsonParser<{ summary: string; confidence: number; supportingFactIds: string[] }>();
        const parsed = parser.parse(response.text);

        if (parsed.error || !parsed.data) {
            this.logger.error("解析画像提炼模型的响应失败:", parsed.error);
            return existingProfile;
        }

        const { summary, confidence, supportingFactIds } = parsed.data;
        const newEmbedding = await this.embeddingModel.embed(summary);

        const allSupportingFactIds = Array.from(
            new Set([...(existingProfile?.supportingFactIds || []), ...supportingFactIds])
        );

        const profileData: UserProfile = {
            // ... id, entityId, content, embedding, etc.
            id: existingProfile?.id || `prof_${uuidv4()}`,
            entityId,
            content: summary,
            embedding: newEmbedding.embedding,
            confidence,
            supportingFactIds: allSupportingFactIds,
            updatedAt: new Date(),
        };

        // 1. 再次检查 existingProfile 是否存在
        if (existingProfile) {
            await this.ctx.database.set(TableName.UserProfiles, { id: existingProfile.id }, profileData);
            this.logger.info(`已成功为实体 ${entityId} 更新了人物画像。`);
        } else {
            // 如果不存在，执行 create
            await this.ctx.database.create(TableName.UserProfiles, profileData);
            this.logger.info(`已成功为实体 ${entityId} 创建了新的人物画像。`);
        }

        return profileData;
    }

    async decayAndForget(): Promise<void> {
        this.logger.info("开始执行记忆衰减与遗忘任务...");
        const { stalenessDays, salienceThreshold, accessCountThreshold } = this.config.forgetting;

        const stalenessDate = new Date();
        stalenessDate.setDate(stalenessDate.getDate() - stalenessDays);

        const forgettableFacts = await this.ctx.database.get(TableName.Facts, {
            lastAccessedAt: { $lt: stalenessDate },
            salience: { $lt: salienceThreshold },
            accessCount: { $lt: accessCountThreshold },
        });

        if (forgettableFacts.length > 0) {
            const idsToRemove = forgettableFacts.map((fact) => fact.id);
            await this.ctx.database.remove(TableName.Facts, { id: { $in: idsToRemove } });
            this.logger.info(`已遗忘 ${idsToRemove.length} 条陈旧且不重要的事实。`);
        } else {
            this.logger.info("没有需要遗忘的事实。");
        }
    }
}
