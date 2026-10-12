import { Context, h, Schema } from "koishi";

import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { Infer } from "@/services/extension/types";
import { MemoryService } from "@/services/memory";
import { Services } from "@/shared/constants";

@Extension({
    name: "memory",
    display: "记忆管理",
    version: "2.0.0",
    description: "管理智能体的记忆",
    author: "MiaowFISH",
    builtin: true,
})
export default class MemoryExtension {
    static readonly Config = Schema.object({
        // topics: Schema.array(Schema.string()).default().description("记忆的主要主题分类。"),
    });

    static readonly inject = [Services.Memory];

    constructor(public ctx: Context, public config: any) {}

    private get memoryService(): MemoryService {
        if (!this.ctx[Services.Memory]) {
            throw new Error("Memory service is not available");
        }
        return this.ctx[Services.Memory];
    }

    // @Tool({
    //     name: "archival_memory_insert",
    //     description:
    //         "Stores new information into your archival memory. This is for long-term storage of reflections, insights, facts, or any detailed information that doesn't belong in the always-visible core memory.",
    //     parameters: withInnerThoughts({
    //         content: Schema.string()
    //             .required()
    //             .description(
    //                 "The information to store in archival memory. Should be detailed and self-contained for better future retrieval."
    //             ),
    //         metadata: Schema.object(Schema.any).description(
    //             'Optional key-value pairs to categorize the memory. For example: {"source": "conversation:12345", "topic": "machine_learning"}'
    //         ),
    //     }),
    // })
    // async archivalMemoryInsert({ content, metadata }: Infer<{ content: string; metadata?: Record<string, any> }>) {
    //     try {
    //         const result = await this.memoryService.storeInArchivalMemory(content, metadata);
    //         if (!result.success) return Failed(result.message);
    //         return Success(result.message, result.data);
    //     } catch (e) {
    //         return Failed(`Failed to insert into archival memory: ${e.message}`);
    //     }
    // }

    // @Tool({
    //     name: "archival_memory_search",
    //     description:
    //         "Performs a semantic search on your archival memory to find the most relevant information based on a query. Returns a list of the most relevant entries.",
    //     parameters: withInnerThoughts({
    //         query: Schema.string()
    //             .required()
    //             .description("The natural language query to search for relevant memories."),
    //         top_k: Schema.number()
    //             .default(10)
    //             .max(50)
    //             .description("Maximum number of results to return (default: 10)."),
    //         similarity_threshold: Schema.number()
    //             .min(0)
    //             .max(1)
    //             .description("Minimum similarity score (0 to 1) for a result to be included."),
    //         filterMetadata: Schema.object(Schema.any).description(
    //             "Optional key-value pairs to filter entries by their metadata."
    //         ),
    //     }),
    // })
    // async archivalMemorySearch(
    //     args: Infer<{
    //         query: string;
    //         top_k?: number;
    //         similarity_threshold?: number;
    //         filterMetadata?: Record<string, any>;
    //     }>
    // ) {
    //     const { query, top_k, similarity_threshold, filterMetadata } = args;
    //     try {
    //         const searchResult = await this.memoryService.searchArchivalMemory(query, {
    //             topK: top_k,
    //             similarityThreshold: similarity_threshold,
    //             filterMetadata: filterMetadata,
    //         });

    //         if (searchResult.results.length === 0) {
    //             return Success("No relevant memories found in archival memory for your query.");
    //         }

    //         // const formattedResults = searchResult.results
    //         //     .map((entry) => this.memoryService.archivalStore.renderEntryText(entry))
    //         //     .join("\n---\n");

    //         return Success({
    //             summary: `Found ${searchResult.results.length} relevant memories (out of ${searchResult.total} total).`,
    //             results: searchResult.results,
    //         });
    //     } catch (e) {
    //         return Failed(`Failed to search archival memory: ${e.message}`);
    //     }
    // }

    @Tool({
        name: "conversation_search",
        description:
            "Searches your raw conversation history (recall memory). Useful for finding specific keywords, names, or direct quotes from past conversations.",
        parameters: withInnerThoughts({
            query: Schema.string()
                .required()
                .description("The search term to find in past messages. This is a keyword-based search."),
            limit: Schema.number()
                .min(1)
                .default(10)
                .max(20)
                .description("Maximum number of messages to return (default: 10, max: 20)."),
            offset: Schema.number().min(0).step(1).default(0).description("分页位置；用返回的 nextOffset 继续"),
            channel_id: Schema.string().description("Optional: Filter by a specific channel ID."),
            user_id: Schema.string().description(
                "Optional: Filter by messages sent by a specific user ID (not the bot's own ID)."
            ),
        }),
    })
    async conversationSearch(args: Infer<{ query: string; limit?: number; offset?: number; channel_id?: string; user_id?: string }>) {
        try {
            if (args.channel_id && args.channel_id !== args.session.channelId) return Failed("聊天召回仅限当前频道；跨频道请使用已配置共同域的 person_recall");
            const result = await this.ctx[Services.WorldState].recallContext(args.session, {
                kind: "messages", query: args.query, limit: args.limit ?? 10, offset: args.offset, userId: args.user_id,
            });
            return Success(result);
        } catch (error) { return Failed(`召回失败：${String(error)}`); }

    }
    @Tool({
        name: "memory_recall",
        description: "分页读取当前频道原始消息、L2 摘要或 L3 日记并提供完整原文；不裁正文。返回 hasMore 时用 nextOffset 继续。display 仅控制是否同时发送到聊天窗口，结果始终作为观察提供给你。",
        parameters: withInnerThoughts({
            kind: Schema.union(["messages", "l2", "l3"]).default("l3"),
            id: Schema.string().description("可选：按召回记录 ID 读取完整条目"),
            query: Schema.string().description("可选关键词，按字面匹配"),
            start: Schema.string().description("可选开始日期或时间"),
            end: Schema.string().description("可选结束日期或时间"),
            user_id: Schema.string().description("messages 可按发送者 ID 筛选"),
            offset: Schema.number().min(0).step(1).default(0),
            limit: Schema.number().min(1).max(20).step(1).default(6),
            display: Schema.boolean().default(false).description("是否同时向当前聊天窗口显示原文"),
        }),
    })
    async memoryRecall(args: Infer<{ kind?: "messages" | "l2" | "l3"; id?: string; query?: string; start?: string; end?: string; user_id?: string; offset?: number; limit?: number; display?: boolean }>) {
        try {
            const result = await this.ctx[Services.WorldState].recallContext(args.session, { ...args, userId: args.user_id });
            return this.withDisplay(args.session, result, args.display);
        } catch (error) { return Failed(`召回失败：${String(error)}`); }
    }

    @Tool({
        name: "l3_diary_generate",
        description: "手动触发当前频道 L3 日记，日期默认今天；读取完整生成结果到下一轮上下文。需要已启用 L3，不覆盖旧日记。没有新消息或材料不足时不生成。display 只控制聊天窗口显示。",
        parameters: withInnerThoughts({
            date: Schema.string().description("可选 YYYY-MM-DD，服务器本地日期"),
            display: Schema.boolean().default(false),
        }),
    })
    async generateDiary(args: Infer<{ date?: string; display?: boolean }>) {
        try {
            const result = await this.ctx[Services.WorldState].triggerDiary(args.session, args.date);
            return this.withDisplay(args.session, result, args.display);
        } catch (error) { return Failed(`L3 触发失败：${String(error)}`); }
    }

    private async withDisplay(session: Infer<{}>["session"], result: unknown, display: boolean) {
        if (!display) return Success(result, { display: "silent" });
        try { await this.displayRecall(session, result); return Success(result, { display: "sent" }); }
        catch (error) { return Success(result, { display: "failed", displayError: String(error) }); }
    }

    private async displayRecall(session: Infer<{}>["session"], result: unknown) {
        const text = Array.from(JSON.stringify(result, null, 2));
        for (let i = 0; i < text.length; i += 3000) await session.send(h.text(text.slice(i, i + 3000).join("")));
    }

}
