import { Schema } from "koishi";

import { Metadata, Tool } from "../plugin/decorators";
import { YesImPlugin } from "../plugin/plugin";
import type { ToolExecutionContext, ToolResult } from "../plugin/types";
import { Failed, Success } from "../plugin/utils";
import { MemoryScope, MemoryType } from "./types";

const MEMORY_TABLE = "yesimbot.memory";

@Metadata({
  name: "memory-recall",
  description: "Memory recall tool for structured memory retrieval",
  builtin: true,
})
export class MemoryRecallPlugin extends YesImPlugin {
  static inject = ["yesimbot.plugin", "database"];

  @Tool({
    name: "recall",
    description:
      "Search structured memories by keyword, type, or scope. " +
      "Returns relevant memories about users, events, channel info, or your own experiences. " +
      "Use this to remember past interactions and context.",
    parameters: Schema.object({
      query: Schema.string().description("Search keyword to filter memory content (optional)"),
      type: Schema.union([
        Schema.const("profile"),
        Schema.const("event"),
        Schema.const("channel"),
        Schema.const("experience"),
      ]).description("Memory type filter (optional)"),
      limit: Schema.number().default(10).description("Max results (default 10)"),
    }),
  })
  async recall(
    params: Record<string, unknown>,
    toolCtx: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const query = params.query as string | undefined;
      const type = params.type as MemoryType | undefined;
      const limit = (params.limit as number) ?? 10;

      // Auto-scope to current channel context
      const isDirect = toolCtx.session?.isDirect ?? false;
      const scope = isDirect ? MemoryScope.Private : MemoryScope.Channel;
      const scopeId = `${toolCtx.platform}:${toolCtx.channelId}`;

      // Query channel/private scoped memories
      const where: Record<string, unknown> = { scope, scopeId };
      if (type) where.type = type;

      const scopedMemories = await this.ctx.database
        .select(MEMORY_TABLE)
        .where(where)
        .orderBy("importance", "desc")
        .limit(limit)
        .execute();

      // Also include user-level memories (visible across channels)
      const userWhere: Record<string, unknown> = {
        scope: MemoryScope.User,
        platform: toolCtx.platform,
      };
      if (type) userWhere.type = type;

      const userMemories = await this.ctx.database
        .select(MEMORY_TABLE)
        .where(userWhere)
        .orderBy("importance", "desc")
        .limit(limit)
        .execute();

      // Combine and deduplicate by id
      const seen = new Set<string>();
      let results = [...scopedMemories, ...userMemories].filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      // Filter by query keyword if provided
      if (query) {
        const lowerQuery = query.toLowerCase();
        results = results.filter((m) => m.content.toLowerCase().includes(lowerQuery));
      }

      // Sort by importance descending and limit
      results.sort((a, b) => b.importance - a.importance);
      results = results.slice(0, limit);

      if (results.length === 0) {
        return Success("No memories found.");
      }

      const formatted = results.map((m) => `[${m.type}/${m.scope}] ${m.content}`).join("\n");

      return Success(formatted);
    } catch (err) {
      return Failed(`Memory recall failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
