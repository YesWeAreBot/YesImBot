import { TableName } from "@/services/types";
import { MessageData } from "@/services/worldstate";
import { formatDate, isEmpty, truncate } from "@/shared";
import { Query, Schema } from "koishi";
import { Extension, Tool } from "../decorators";
import { BaseExtension, Failed, Success } from "../helpers";
import { Infer } from "../types";

@Extension({
    name: "Memory",
    version: "1.0.0",
    description: "Memory service",
    author: "MiaowFISH",
})
export default class MemoryExtension extends BaseExtension {
    @Tool({
        name: "core_memory_append",
        description: "Appends new content to a specified sub-block of your core memory (persona or human).",
        parameters: Schema.object({
            label: Schema.union(["persona", "human"]).required().description("The core memory sub-block to edit ('persona' or 'human')."),
            content: Schema.string().description(
                "The content to append. Each new piece of content should be a distinct thought or piece of information."
            ),
        }),
    })
    async coreMemoryAppend({ session, label, content }: Infer<{ label?: string; content?: string }>) {
        if (isEmpty(label) || isEmpty(content)) return Failed("label and content is required");
        try {
            const result = await this.ctx["yesimbot.memory"].appendToCoreMemory(label, content);
            this.ctx.logger.info(`Bot[${session.selfId}]追加内容到核心记忆块 ${label}: ${content}`);
            return Success(result);
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]追加内容到核心记忆块失败: ${label}, ${content} - `, e.message);
            return Failed(`追加内容到核心记忆块失败： ${e.message}`);
        }
    }

    @Tool({
        name: "core_memory_replace",
        description:
            "Replaces existing content with new content in a specified sub-block of your core memory (persona or human). The old content must be an exact match.",
        parameters: Schema.object({
            label: Schema.union(["persona", "human"]).description("The core memory sub-block to edit ('persona' or 'human')."),
            old_content: Schema.string().description("The exact content to be replaced."),
            new_content: Schema.string().description(
                "The new content to replace the old content. If empty, the old content will be deleted."
            ),
        }),
    })
    async coreMemoryReplace(args: Infer<{ label?: string; old_content?: string; new_content?: string }>) {
        const { session, label, old_content, new_content } = args;
        if (isEmpty(label) || isEmpty(old_content)) return Failed("label and old_content is required");
        try {
            const result = await this.ctx["yesimbot.memory"].replaceInCoreMemory(label, old_content, new_content);
            this.ctx.logger.info(`Bot[${session.selfId}]替换内容到核心记忆块 ${label}: ${old_content} -> ${new_content}`);
            return Success(result);
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]替换内容到核心记忆块失败: ${label}, ${old_content}, ${new_content} - `, e.message);
            return Failed(`替换内容到核心记忆块失败： ${e.message}`);
        }
    }

    @Tool({
        name: "archival_memory_insert",
        description: "Stores new information into your archival memory for long-term storage and later retrieval.",
        parameters: Schema.object({
            content: Schema.string().description(
                "The information to store in archival memory. This can be reflections, insights, facts, or any detailed information."
            ),
            metadata: Schema.object(Schema.any).description("Optional key-value pairs to categorize or add context to the memory entry."),
        }),
    })
    async archivalMemoryInsert({ session, content, metadata }: Infer<{ content: string; metadata: Record<string, any> }>) {
        if (isEmpty(content)) return Failed("content is required");
        try {
            const entry = await this.ctx["yesimbot.memory"].storeInArchivalMemory(content, metadata);
            this.ctx.logger.info(`Bot[${session.selfId}]插入内容到归档记忆: ${content}`);
            return Success(`Content stored in archival memory with ID: ${entry.id}.`, { entry_id: entry.id });
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]插入内容到归档记忆失败: ${content} - `, e.message);
            return Failed(`插入内容到归档记忆失败： ${e.message}`);
        }
    }

    @Tool({
        name: "archival_memory_search",
        description: "Searches your archival memory for entries matching a query. Returns a list of matching entries.",
        parameters: Schema.object({
            query: Schema.string().description("The search query to find relevant information in archival memory."),
            page: Schema.number().description("The page number for pagination of results (default: 1)."),
            pageSize: Schema.number().max(50).description("Number of results per page (default: 10, max: 50)."),
            filterMetadata: Schema.object(Schema.any).description("Key-value pairs to filter entries by their metadata."),
        }),
    })
    async archivalMemorySearch(args: Infer<{ query: string; page: number; pageSize: number; filterMetadata: Record<string, any> }>) {
        const { session, query, page, pageSize, filterMetadata } = args;
        if (isEmpty(query)) return Failed("query is required");
        try {
            const searchResult = await this.ctx["yesimbot.memory"].searchArchivalMemory(query, {
                page: page,
                pageSize: pageSize,
                filterMetadata: filterMetadata,
            });
            const formattedResults = searchResult.results.map((entry) => this.ctx["yesimbot.memory"].archivalStore.renderEntryText(entry));
            return Success({
                total_found: searchResult.total,
                results_count: searchResult.results.length,
                page: page || 1,
                results: formattedResults,
            });
        } catch (e) {
            this.ctx.logger.error(`Bot[${session.selfId}]搜索归档记忆失败: ${query} - `, e.message);
            return Failed(`搜索归档记忆失败： ${e.message}`);
        }
    }

    @Tool({
        name: "conversation_search",
        description: "Searches your entire message history (recall memory) for past interactions based on a query.",
        parameters: Schema.object({
            query: Schema.string().description("The search term to find in past messages. Supports simple keyword matching."),
            limit: Schema.number().description("Maximum number of messages to return (default: 5, max: 25)."),
            channel_id: Schema.string().description("Filter by a specific channel ID."),
            user_id: Schema.string().description("Filter by messages sent by a specific user ID (not the bot)."),
        }),
    })
    async conversationSearch(args: Infer<{ query: string; limit: number; channel_id: string; user_id: string }>) {
        const { session, query, limit, channel_id, user_id } = args;
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
                whereClauses.push({ sender: { id: user_id } });
            }
            // Combine clauses with $and if multiple are present
            const finalQuery: Query<MessageData> = whereClauses.length > 1 ? { $and: whereClauses } : whereClauses[0] || {};

            const messages = await this.ctx.database
                .select(TableName.Messages)
                .where(finalQuery)
                .limit(limit)
                .orderBy("timestamp", "desc")
                .execute();

            if (!messages || messages.length === 0) {
                return Failed("No matching messages found in recall memory.");
            }

            const formattedResults = messages.map(
                (msg) =>
                    `[${msg.id}|${formatDate(msg.timestamp, "YYYY-MM-DD HH:mm:ss")}|${msg.sender.name}(${msg.sender.id})] ${truncate(
                        msg.content,
                        100
                    )}`
            );
            return Success({ results_count: messages.length, results: formattedResults });
        } catch (e: any) {
            this.ctx.logger.error(`Conversation search failed: ${e.message}`);
            return Failed("Failed to search conversation history." + e.message);
        }
    }
}
