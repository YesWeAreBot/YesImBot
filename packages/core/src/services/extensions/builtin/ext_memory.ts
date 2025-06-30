import { Context, Query, Schema } from "koishi";
import { MemoryService } from "../../memory/MemoryService";
import { createExtension, createTool, Failed, Success, withCommonParams } from "../helpers";
import { ExtensionMetadata } from "../types";
import { MessageData, TableName } from "../../worldstate";

const metadata: ExtensionMetadata = {
    name: "Memory",
    version: "1.0.0",
    description: "Memory service",
    author: "MiaowFISH",
};

// 1. Core Memory Append Tool
const CoreMemoryAppendTool = createTool({
    name: "core_memory_append",
    description: "Appends new content to a specified sub-block of your core memory (persona or human).",
    parameters: withCommonParams({
        label: Schema.union(["persona", "human"]).description("The core memory sub-block to edit ('persona' or 'human')."),
        content: Schema.string().description(
            "The content to append. Each new piece of content should be a distinct thought or piece of information."
        ),
    }),
    execute: async (ctx, { label, content }) => {
        const { koishiContext } = ctx;
        try {
            const result = await getMemory(koishiContext).appendToCoreMemory(label, content);
            return Success(result);
        } catch (e: any) {
            return Failed(e.message);
        }
    },
});

// 2. Core Memory Replace Tool
const CoreMemoryReplaceTool = createTool({
    name: "core_memory_replace",
    description:
        "Replaces existing content with new content in a specified sub-block of your core memory (persona or human). The old content must be an exact match.",
    parameters: withCommonParams({
        label: Schema.union(["persona", "human"]).description("The core memory sub-block to edit ('persona' or 'human')."),
        old_content: Schema.string().description("The exact content to be replaced."),
        new_content: Schema.string().description("The new content to replace the old content. If empty, the old content will be deleted."),
    }),
    execute: async (ctx, { label, old_content, new_content }) => {
        const { koishiContext } = ctx;
        try {
            const result = await getMemory(koishiContext).replaceInCoreMemory(label, old_content, new_content);
            return Success(result);
        } catch (e: any) {
            return Failed(e.message);
        }
    },
});

// 3. Archival Memory Insert Tool
const ArchivalMemoryInsertTool = createTool({
    name: "archival_memory_insert",
    description: "Stores new information into your archival memory for long-term storage and later retrieval.",
    parameters: withCommonParams({
        content: Schema.string().description(
            "The information to store in archival memory. This can be reflections, insights, facts, or any detailed information."
        ),
        metadata: Schema.object(Schema.any).description("Optional key-value pairs to categorize or add context to the memory entry."),
    }),
    execute: async (ctx, { content, metadata }) => {
        const { koishiContext } = ctx;
        try {
            const entry = await getMemory(koishiContext).storeInArchivalMemory(content, metadata);
            return Success(`Content stored in archival memory with ID: ${entry.id}.`, { entry_id: entry.id });
        } catch (e: any) {
            return Failed(e.message);
        }
    },
});

// 4. Archival Memory Search Tool
const ArchivalMemorySearchTool = createTool({
    name: "archival_memory_search",
    description: "Searches your archival memory for entries matching a query. Returns a list of matching entries.",
    parameters: withCommonParams({
        query: Schema.string().description("The search query to find relevant information in archival memory."),
        page: Schema.number().description("The page number for pagination of results (default: 1)."),
        pageSize: Schema.number().max(50).description("Number of results per page (default: 10, max: 50)."),
        filterMetadata: Schema.object(Schema.any).description("Key-value pairs to filter entries by their metadata."),
    }),
    execute: async (ctx, { query, page, pageSize, filterMetadata }) => {
        const { koishiContext } = ctx;
        try {
            const searchResult = await getMemory(koishiContext).archivalStore.search(query, {
                page: page,
                pageSize: pageSize,
                filterMetadata: filterMetadata,
            });
            const formattedResults = searchResult.results.map((entry) => getMemory(koishiContext).archivalStore.renderEntryText(entry));
            return Success({
                total_found: searchResult.total,
                results_count: searchResult.results.length,
                page: page || 1,
                results: formattedResults,
            });
        } catch (e: any) {
            return Failed(e.message);
        }
    },
});

// 5. Conversation Search Tool (Recall Memory)
const ConversationSearchTool = createTool({
    name: "conversation_search",
    description: "Searches your entire message history (recall memory) for past interactions based on a query.",
    parameters: withCommonParams({
        query: Schema.string().description("The search term to find in past messages. Supports simple keyword matching."),
        limit: Schema.number().description("Maximum number of messages to return (default: 5, max: 25)."),
        channel_id: Schema.string().description("Filter by a specific channel ID."),
        user_id: Schema.string().description("Filter by messages sent by a specific user ID (not the bot)."),
    }),
    execute: async (ctx, { query, limit, channel_id, user_id }) => {
        const { koishiContext } = ctx;
        try {
            const whereClauses: Query.Expr<MessageData>[] = [];

            // Basic text search across 'content'
            // For more advanced search, you might need full-text search capabilities in your DB
            if (query) {
                whereClauses.push({ content: { $regex: new RegExp(query, "i") } });
            }
            if (channel_id) {
                whereClauses.push({ channelId: channel_id });
            }
            if (user_id) {
                whereClauses.push({ sender: { pid: user_id } });
            }
            // Combine clauses with $and if multiple are present
            const finalQuery: Query<MessageData> = whereClauses.length > 1 ? { $and: whereClauses } : whereClauses[0] || {};

            const messages = await koishiContext.database
                .select(TableName.Messages)
                .where(finalQuery)
                .limit(limit)
                .orderBy("timestamp", "desc")
                .execute();

            if (!messages || messages.length === 0) {
                return Failed("No matching messages found in recall memory.");
            }

            const formattedResults = messages.map(
                (msg) => `[${new Date(msg.timestamp).toISOString()}] ` + `${msg.sender.name || msg.sender.pid}: ${msg.content}`
            );
            return Success({ results_count: messages.length, results: formattedResults });
        } catch (e: any) {
            koishiContext.logger.error(`Conversation search failed: ${e.message}`);
            return Failed("Failed to search conversation history." + e.message);
        }
    },
});

function getMemory(ctx: Context): MemoryService {
    const memory = ctx["yesimbot.memory"];
    if (!memory) throw new Error("MemoryService not available on context.");
    return memory;
}

export default createExtension({
    metadata,
    tools: [CoreMemoryAppendTool, CoreMemoryReplaceTool, ConversationSearchTool, ArchivalMemoryInsertTool, ArchivalMemorySearchTool],
});
