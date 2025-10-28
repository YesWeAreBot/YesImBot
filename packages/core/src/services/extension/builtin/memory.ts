import { Context, Query, Schema } from "koishi";

import { MemoryService } from "@/services";
import { Metadata, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Plugin } from "@/services/extension/plugin";
import { Failed, Success } from "@/services/extension/result-builder";
import { ToolContext } from "@/services/extension/types";
import { MessageData } from "@/services/worldstate";
import { Services, TableName } from "@/shared";
import { formatDate, truncate } from "@/shared/utils";

interface MemoryConfig { }

@Metadata({
    name: "memory",
    display: "记忆管理",
    version: "2.0.0",
    description: "管理智能体的记忆",
    author: "MiaowFISH",
    builtin: true,
})
export default class MemoryExtension extends Plugin<MemoryConfig> {
    static readonly Config: Schema<MemoryConfig> = Schema.object({
        // topics: Schema.array(Schema.string()).default().description("记忆的主要主题分类。"),
    });

    static readonly inject = [Services.Memory];

    constructor(ctx: Context, config: MemoryConfig) {
        super(ctx, config);
    }

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
    async conversationSearch(args: { query: string; limit?: number; channel_id?: string; user_id?: string }, context: ToolContext) {
        const { query, limit = 10, channel_id, user_id } = args;

        try {
            const whereClauses: Query.Expr<MessageData>[] = [{ payload: { content: { $regex: new RegExp(query, "i") } }, type: "message" }];
            if (channel_id) whereClauses.push({ channelId: channel_id });
            if (user_id) whereClauses.push({ payload: { sender: { id: user_id } } });

            const finalQuery: Query<MessageData> = { $and: whereClauses };

            const results = (await this.ctx.database
                .select(TableName.Events)
                .where(finalQuery)
                .limit(limit)
                .orderBy("timestamp", "desc")
                .execute()) as MessageData[];

            if (!results || results.length === 0) {
                return Success("No matching messages found in recall memory.");
            }

            /* prettier-ignore */
            const formattedResults = results.map((msg) => `[${formatDate(msg.timestamp, "YYYY-MM-DD HH:mm")}|${msg.payload.sender.name || "user"}(${msg.payload.sender.id})] ${truncate(msg.payload.content, 120)}`);
            return Success({
                results_count: results.length,
                results: formattedResults,
            });
        } catch (e: any) {
            this.ctx.logger.error(`[MemoryTool] Conversation search failed for query "${query}": ${e.message}`);
            return Failed(`Failed to search conversation history: ${e.message}`);
        }
    }
}
