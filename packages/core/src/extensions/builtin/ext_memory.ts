import { Context, Field, Query } from "koishi";
import { z } from "zod";
import { MemoryError } from "../../memory/MemoryError";
import { MemoryService } from "../../memory/MemoryService";
import { Message, MESSAGE_TABLE } from "../../types/model";
import { INNER_THOUGHTS, REQUEST_HEARTBEAT, Tool } from "../base";

// Helper to get MemoryService instance
function getMemory(ctx: Context): MemoryService {
    if (!ctx.memory) throw new Error("MemoryService not available on context.");
    return ctx.memory;
}

// 1. Core Memory Append Tool
export const CoreMemoryAppendTool = Tool({
    name: "core_memory_append",
    description: "Appends new content to a specified sub-block of your core memory (persona or human).",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        label: z.enum(["persona", "human"]).describe("The core memory sub-block to edit ('persona' or 'human')."),
        content: z
            .string()
            .describe("The content to append. Each new piece of content should be a distinct thought or piece of information."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ label, content }, context) => {
        const { koishiContext } = context;
        try {
            const result = await getMemory(koishiContext).appendToCoreMemory(label, content);
            return { success: true, message: result };
        } catch (e: any) {
            return { success: false, error: e.message, context: e instanceof MemoryError && e.context ? e.context : undefined };
        }
    },
});

// 2. Core Memory Replace Tool
export const CoreMemoryReplaceTool = Tool({
    name: "core_memory_replace",
    description:
        "Replaces existing content with new content in a specified sub-block of your core memory (persona or human). The old content must be an exact match.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        label: z.enum(["persona", "human"]).describe("The core memory sub-block to edit ('persona' or 'human')."),
        old_content: z.string().describe("The exact content to be replaced."),
        new_content: z.string().describe("The new content to replace the old content. If empty, the old content will be deleted."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ label, old_content, new_content }, context) => {
        const { koishiContext } = context;
        try {
            const result = await getMemory(koishiContext).replaceInCoreMemory(label, old_content, new_content);
            return { success: true, message: result };
        } catch (e: any) {
            return { success: false, error: e.message, context: e instanceof MemoryError && e.context ? e.context : undefined };
        }
    },
});

// 3. Archival Memory Insert Tool
export const ArchivalMemoryInsertTool = Tool({
    name: "archival_memory_insert",
    description: "Stores new information into your archival memory for long-term storage and later retrieval.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        content: z
            .string()
            .describe(
                "The information to store in archival memory. This can be reflections, insights, facts, or any detailed information."
            ),
        metadata: z.record(z.any()).optional().describe("Optional key-value pairs to categorize or add context to the memory entry."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ content, metadata }, context) => {
        const { koishiContext } = context;
        try {
            const entry = await getMemory(koishiContext).storeInArchivalMemory(content, metadata);
            return { success: true, message: `Content stored in archival memory with ID: ${entry.id}.`, entry_id: entry.id };
        } catch (e: any) {
            return { success: false, error: e.message, context: e instanceof MemoryError && e.context ? e.context : undefined };
        }
    },
});

// 4. Archival Memory Search Tool
export const ArchivalMemorySearchTool = Tool({
    name: "archival_memory_search",
    description: "Searches your archival memory for entries matching a query. Returns a list of matching entries.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        query: z.string().describe("The search query to find relevant information in archival memory."),
        page: z.number().int().positive().optional().describe("The page number for pagination of results (default: 1)."),
        pageSize: z.number().int().positive().max(50).optional().describe("Number of results per page (default: 10, max: 50)."),
        filterMetadata: z.record(z.any()).optional().describe("Key-value pairs to filter entries by their metadata."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ query, page, pageSize, filterMetadata }, context) => {
        const { koishiContext } = context;
        try {
            const searchResult = await getMemory(koishiContext).archivalStore.search(query, {
                page: page,
                pageSize: pageSize,
                filterMetadata: filterMetadata,
            });
            const formattedResults = searchResult.results.map((entry) => getMemory(koishiContext).archivalStore.renderEntryText(entry));
            return {
                success: true,
                total_found: searchResult.total,
                results_count: searchResult.results.length,
                page: page || 1,
                results: formattedResults,
            };
        } catch (e: any) {
            return { success: false, error: e.message, context: e instanceof MemoryError && e.context ? e.context : undefined };
        }
    },
});

// 5. Conversation Search Tool (Recall Memory)
export const ConversationSearchTool = Tool({
    name: "conversation_search",
    description: "Searches your entire message history (recall memory) for past interactions based on a query.",
    parameters: z.object({
        inner_thoughts: INNER_THOUGHTS,
        query: z.string().describe("The search term to find in past messages. Supports simple keyword matching."),
        limit: z.number().int().positive().max(25).optional().describe("Maximum number of messages to return (default: 5, max: 25)."),
        channel_id: z.string().optional().describe("Filter by a specific channel ID."),
        user_id: z.string().optional().describe("Filter by messages sent by a specific user ID (not the bot)."),
        request_heartbeat: REQUEST_HEARTBEAT,
    }),
    execute: async ({ query, limit, channel_id, user_id }, context) => {
        const { koishiContext } = context;
        try {
            const whereClauses: Query.Expr<Message>[] = []; // Message is your database model type for messages

            // Basic text search across 'content'
            // For more advanced search, you might need full-text search capabilities in your DB
            if (query) {
                whereClauses.push({ content: { $regex: new RegExp(query, "i") } });
            }
            if (channel_id) {
                whereClauses.push({ channel: { id: channel_id } });
            }
            if (user_id) {
                whereClauses.push({ sender: { id: user_id } });
            }
            // Combine clauses with $and if multiple are present
            const finalQuery: Query<Message> = whereClauses.length > 1 ? { $and: whereClauses } : whereClauses[0] || {};

            const messages = await koishiContext.database
                .select(MESSAGE_TABLE)
                .where(finalQuery)
                .limit(limit)
                .orderBy("timestamp", "desc")
                .execute();

            if (!messages || messages.length === 0) {
                return { success: true, message: "No matching messages found in recall memory.", results: [] };
            }

            const formattedResults = messages.map(
                (msg) => `[${new Date(msg.timestamp).toISOString()}] ` + `${msg.sender.name || msg.sender.id}: ${msg.content}`
            );
            return { success: true, results_count: messages.length, results: formattedResults };
        } catch (e: any) {
            koishiContext.logger.error(`Conversation search failed: ${e.message}`);
            return { success: false, error: "Failed to search conversation history." };
        }
    },
});
