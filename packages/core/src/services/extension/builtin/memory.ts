import { Context, Query, Schema } from "koishi";

import { MemoryService } from "@/services/memory";
import { Services, TableName } from "@/services/types";
import { MessageData } from "@/services/worldstate";
import { formatDate, isEmpty, truncate } from "@/shared";
import { Extension, Tool } from "../decorators";
import { Failed, Success } from "../helpers";
import { Infer } from "../types";

@Extension({
    name: "memory",
    display: "记忆管理",
    version: "2.0.0",
    description: "管理智能体的记忆",
    author: "MiaowFISH",
})
export default class MemoryExtension {
    static readonly Config = Schema.object({});

    constructor(public ctx: Context, public config: any) {}

    private get memoryService(): MemoryService {
        if (!this.ctx[Services.Memory]) {
            throw new Error("Memory service is not available");
        }
        return this.ctx[Services.Memory];
    }

    private getAvailableCoreLabels(): string[] {
        return this.memoryService.getAllCoreMemoryBlocks().map((b) => b.label);
    }

    @Tool({
        name: "core_memory_append",
        description: "Appends a SINGLE new line to a core memory block. This is a lightweight tool for simple additions.",
        parameters: Schema.object({
            label: Schema.string().required().description("The label of the core memory block to edit."),
            content: Schema.string().required().description("The content to append as a new line. Do not include newlines in this string."),
        }),
    })
    async coreMemoryAppend({ session, label, content }: Infer<{ label: string; content: string }>) {
        if (isEmpty(label) || isEmpty(content)) return Failed("Parameters 'label' and 'content' are required.");
        if (content.includes("\n")) {
            /* prettier-ignore */
            return Failed("Content for append cannot contain newlines. For multi-line changes, use the 'get_content' and 'overwrite' tools.");
        }

        const availableLabels = this.getAvailableCoreLabels();
        if (!availableLabels.includes(label)) {
            return Failed(`Invalid core memory label '${label}'. Available labels are: [${availableLabels.join(", ")}]`);
        }

        try {
            const result = await this.ctx["yesimbot.memory"].appendToCoreMemory(label, content);
            this.ctx.logger.info(`[MemoryTool] Agent[${session.selfId}] appended to core memory <${label}>: "${truncate(content)}"`);
            return Success(result);
        } catch (e) {
            this.ctx.logger.error(`[MemoryTool] Agent[${session.selfId}] failed to append to core memory <${label}>:`, e.message);
            return Failed(`Failed to append to core memory: ${e.message}`);
        }
    }

    @Tool({
        name: "core_memory_replace",
        description:
            "Replaces a SINGLE existing line with new content in a core memory block. The 'old_content' must be an exact match. This is a lightweight tool for simple, targeted edits.",
        parameters: Schema.object({
            label: Schema.string().required().description("The label of the core memory block to edit."),
            old_content: Schema.string().required().description("The exact, full line of content to be replaced."),
            /* prettier-ignore */
            new_content: Schema.string().description("The new content to replace the old content. Leave empty to delete the line. Do not include newlines."),
        }),
    })
    async coreMemoryReplace(args: Infer<{ label: string; old_content: string; new_content?: string }>) {
        const { session, label, old_content } = args;
        const new_content = args.new_content ?? "";
        if (isEmpty(label) || isEmpty(old_content)) return Failed("Parameters 'label' and 'old_content' are required.");
        if (old_content.includes("\n") || new_content.includes("\n"))
            /* prettier-ignore */
            return Failed("Content for replace cannot contain newlines. For multi-line changes, use the 'get_content' and 'overwrite' tools.");

        const availableLabels = this.getAvailableCoreLabels();
        if (!availableLabels.includes(label)) {
            return Failed(`Invalid core memory label '${label}'. Available labels are: [${availableLabels.join(", ")}]`);
        }

        try {
            const result = await this.memoryService.replaceInCoreMemory(label, old_content, new_content);
            /* prettier-ignore */
            this.ctx.logger.info(`[MemoryTool] Agent[${session.selfId}] replaced in core memory <${label}>: "${truncate(old_content)}" -> "${truncate(new_content)}"`);
            return Success(result);
        } catch (e) {
            this.ctx.logger.error(`[MemoryTool] Agent[${session.selfId}] failed to replace in core memory <${label}>:`, e.message);
            return Failed(`Failed to replace content in core memory: ${e.message}`);
        }
    }

    @Tool({
        name: "core_memory_get_content",
        description:
            "Retrieves the entire raw content of a specified core memory block. Use this as the first step for complex, multi-line modifications, before using 'core_memory_overwrite'.",
        parameters: Schema.object({
            label: Schema.string().required().description("The label of the core memory block to read from."),
        }),
    })
    async coreMemoryGetContent({ session, label }: Infer<{ label: string }>) {
        if (isEmpty(label)) return Failed("Parameter 'label' is required.");

        const block = this.memoryService.getCoreMemoryBlock(label);
        if (!block) {
            const availableLabels = this.getAvailableCoreLabels();
            return Failed(`Invalid core memory label '${label}'. Available labels are: [${availableLabels.join(", ")}]`);
        }

        this.ctx.logger.info(`[MemoryTool] Agent[${session.selfId}] is reading content from core memory <${label}>.`);
        return Success(block.content.join("\n"));
    }

    @Tool({
        name: "core_memory_overwrite",
        description:
            "Completely overwrites the content of a specified core memory block with new, multi-line content. This is a powerful and destructive action. It should always be used after 'core_memory_get_content' to ensure you are not accidentally deleting important information.",
        parameters: Schema.object({
            label: Schema.string().required().description("The label of the core memory block to overwrite."),
            new_content: Schema.string()
                .required()
                .description("The full, new content for the memory block. Use newline characters (\\n) to separate lines."),
        }),
    })
    async coreMemoryOverwrite({ session, label, new_content }: Infer<{ label: string; new_content: string }>) {
        if (isEmpty(label)) return Failed("Parameter 'label' is required.");
        // new_content can be an empty string to clear the block, so we don't use isEmpty
        if (new_content === null || new_content === undefined) return Failed("Parameter 'new_content' is required.");

        const availableLabels = this.getAvailableCoreLabels();
        if (!availableLabels.includes(label)) {
            return Failed(`Invalid core memory label '${label}'. Available labels are: [${availableLabels.join(", ")}]`);
        }

        try {
            const result = await this.memoryService.overwriteCoreMemory(label, new_content);
            this.ctx.logger.info(`[MemoryTool] Agent[${session.selfId}] has overwritten core memory <${label}>.`);
            return Success(result);
        } catch (e) {
            this.ctx.logger.error(`[MemoryTool] Agent[${session.selfId}] failed to overwrite core memory <${label}>:`, e.message);
            return Failed(`Failed to overwrite core memory: ${e.message}`);
        }
    }

    @Tool({
        name: "archival_memory_insert",
        description:
            "Stores new information into your archival memory. This is for long-term storage of reflections, insights, facts, or any detailed information that doesn't belong in the always-visible core memory.",
        parameters: Schema.object({
            content: Schema.string()
                .required()
                .description(
                    "The information to store in archival memory. Should be detailed and self-contained for better future retrieval."
                ),
            metadata: Schema.object(Schema.any).description(
                'Optional key-value pairs to categorize the memory. For example: {"source": "conversation:12345", "topic": "machine_learning"}'
            ),
        }),
    })
    async archivalMemoryInsert({ session, content, metadata }: Infer<{ content: string; metadata?: Record<string, any> }>) {
        if (isEmpty(content)) return Failed("Parameter 'content' is required.");
        try {
            const entry = await this.memoryService.storeInArchivalMemory(content, metadata);
            this.ctx.logger.info(`[MemoryTool] Agent[${session.selfId}] inserted into archival memory: "${truncate(content)}"`);
            return Success(`Content stored in archival memory with ID: ${entry.id}.`, { entry_id: entry.id });
        } catch (e) {
            this.ctx.logger.error(`[MemoryTool] Agent[${session.selfId}] failed to insert into archival memory:`, e.message);
            return Failed(`Failed to insert into archival memory: ${e.message}`);
        }
    }

    @Tool({
        name: "archival_memory_search",
        description:
            "Performs a semantic search on your archival memory to find the most relevant information based on a query. Returns a list of the most relevant entries.",
        parameters: Schema.object({
            query: Schema.string().required().description("The natural language query to search for relevant memories."),
            top_k: Schema.number().default(10).max(50).description("Maximum number of the most relevant results to return (default: 10)."),
            filterMetadata: Schema.object(Schema.any).description(
                "Optional key-value pairs to filter entries by their metadata before searching."
            ),
        }),
    })
    async archivalMemorySearch(args: Infer<{ query: string; top_k?: number; filterMetadata?: Record<string, any> }>) {
        const { session, query, top_k, filterMetadata } = args;
        if (isEmpty(query)) return Failed("Parameter 'query' is required.");
        try {
            const searchResult = await this.memoryService.searchArchivalMemory(query, {
                topK: top_k,
                filterMetadata: filterMetadata,
            });

            if (searchResult.results.length === 0) {
                return Success("No relevant memories found in archival memory for your query.");
            }

            const formattedResults = searchResult.results.map((entry) => this.memoryService.archivalStore.renderEntryText(entry));

            return Success({
                total_entries_in_archival_memory: searchResult.total,
                results_found: searchResult.results.length,
                results: formattedResults,
            });
        } catch (e) {
            this.ctx.logger.error(
                `[MemoryTool] Agent[${session.selfId}] failed to search archival memory with query "${query}":`,
                e.message
            );
            return Failed(`Failed to search archival memory: ${e.message}`);
        }
    }

    @Tool({
        name: "conversation_search",
        description:
            "Searches your raw conversation history (recall memory). Useful for finding specific keywords, names, or direct quotes from past conversations.",
        parameters: Schema.object({
            query: Schema.string().required().description("The search term to find in past messages. This is a keyword-based search."),
            limit: Schema.number().default(10).max(25).description("Maximum number of messages to return (default: 10)."),
            channel_id: Schema.string().description("Optional: Filter by a specific channel ID."),
            user_id: Schema.string().description("Optional: Filter by messages sent by a specific user ID (not the bot's own ID)."),
        }),
    })
    async conversationSearch(args: Infer<{ query: string; limit?: number; channel_id?: string; user_id?: string }>) {
        const { session, query, limit = 10, channel_id, user_id } = args;
        if (isEmpty(query)) return Failed("Parameter 'query' is required.");

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
