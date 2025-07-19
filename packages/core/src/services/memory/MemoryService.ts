import fs from "fs/promises";
import { Context, Service } from "koishi";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { IChatModel, IEmbedModel, TaskType } from "@/services/model";
import { loadPrompt, loadTemplate, PromptService } from "@/services/prompt";
import { Services, TableName } from "@/services/types";
import { AppError, ErrorCodes } from "@/shared/errors";
import { cosineSimilarity, JsonParser } from "@/shared/utils";
import { MemoryConfig } from "./config";
import { MemoryBlock } from "./MemoryBlock";
import {
    ConversationChunk,
    Entity,
    EntityType,
    ExtractedFact,
    ExtractedInsight,
    Fact,
    MemoryBlockData,
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

    private readonly promptService: PromptService;
    private readonly chatModel: IChatModel;
    private readonly embeddingModel: IEmbedModel;
    private readonly jsonParser = new JsonParser<{ facts: ExtractedFact[]; insights: ExtractedInsight[] }>();

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
        this.ctx.on("worldstate:summary", (chunkForSummary) => this.handleSummaryChunk(chunkForSummary));

        this.logger.info("服务已启动，开始监听消息。");
    }

    protected async stop(): Promise<void> {
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

    /**
     * 事件处理主入口：处理从 worldstate 发来的待归档对话片段。
     * @param chunk 包含多用户消息的对话片段
     */
    private async handleSummaryChunk(chunk: string): Promise<void> {
        try {
            // 1. 调用LLM，一次性提取出所有事实和洞察
            const { facts, insights } = await this.extractFromChunk(chunk);
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
        } catch (error) {
            this.logger.error("处理 summary chunk 时出错:", error);
        }
    }

    /**
     * 调用LLM从对话片段中提取事实和洞察。
     * @param chunk 对话片段
     * @returns 提取出的事实和洞察对象
     */
    private async extractFromChunk(chunk: string): Promise<{ facts: ExtractedFact[]; insights: ExtractedInsight[] }> {
        const systemPrompt = await this.promptService.render("memory.fact_extraction");

        const userPrompt = await this.promptService.renderRaw(`Input:\n{{conversationText}}`, {
            conversationText: chunk,
        });

        const { text } = await this.chatModel.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ]);

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

        // 严谨的返回结构校验
        // const facts = parsedResponse?.facts && Array.isArray(parsedResponse.facts) ? parsedResponse.facts : [];
        // const insights =
        //     parsedResponse?.insights && Array.isArray(parsedResponse.insights) ? parsedResponse.insights : [];

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
                const entityPromises = memoryData.relatedEntities.map((e) =>
                    this.addOrGetEntity(e.name, e.type || EntityType.Unknown, e.metadata)
                );
                const entities = await Promise.all(entityPromises);
                entities.forEach((entity) => entityIdSet.add(entity.id));
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
            await this.addFact(factToStore);
            this.logger.debug(`成功存储记忆: "${factToStore.content}"`);
        } catch (error) {
            this.logger.error(`存储单条记忆时出错: "${memoryData.content}"`, error);
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
