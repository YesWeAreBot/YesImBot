import { Context, Query, Schema } from "koishi";

import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { WithSession } from "@/services/extension/types";
import { MemoryService } from "@/services/memory";
import { MessageData } from "@/services/worldstate";
import { formatDate, truncate } from "@/shared";
import { Services, TableName } from "@/shared/constants";

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

    constructor(
        public ctx: Context,
        public config: any
    ) {}

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
    // async archivalMemoryInsert({ content, metadata }: WithSession<{ content: string; metadata?: Record<string, any> }>) {
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
    //     args: WithSession<{
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
            query: Schema.string().required().description("The search term to find in past messages. This is a keyword-based search."),
            limit: Schema.number().min(1).default(10).max(25).description("Maximum number of messages to return (default: 10, max: 25)."),
            channel_id: Schema.string().description("Optional: Filter by a specific channel ID."),
            user_id: Schema.string().description("Optional: Filter by messages sent by a specific user ID (not the bot's own ID)."),
        }),
    })
    async conversationSearch(args: WithSession<{ query: string; limit?: number; channel_id?: string; user_id?: string }>) {
        const { query, limit = 10, channel_id, user_id } = args;

        try {
            const whereClauses: Query.Expr<MessageData>[] = [{ content: { $regex: new RegExp(query, "i") } }];
            if (channel_id) whereClauses.push({ channelId: channel_id });
            if (user_id) whereClauses.push({ sender: { id: user_id } });

            const finalQuery: Query<MessageData> = { $and: whereClauses };

            const messages = await this.ctx.database
                .select(TableName.Messages)
                .where(finalQuery)
                .limit(limit)
                .orderBy("timestamp", "desc")
                .execute();

            if (!messages || messages.length === 0) {
                return Success("No matching messages found in recall memory.");
            }

            /* prettier-ignore */
            const formattedResults = messages.map((msg) =>`[${formatDate(msg.timestamp, "YYYY-MM-DD HH:mm")}|${msg.sender.name || "user"}(${msg.sender.id})] ${truncate(msg.content,120)}`);
            return Success({
                results_count: messages.length,
                results: formattedResults,
            });
        } catch (e: any) {
            this.ctx.logger.error(`[MemoryTool] Conversation search failed for query "${query}": ${e.message}`);
            return Failed(`Failed to search conversation history: ${e.message}`);
        }
    }
}
