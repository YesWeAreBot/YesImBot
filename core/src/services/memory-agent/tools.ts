import { tool } from "ai";
import { Random, type Context } from "koishi";
import { z } from "zod";

import { ChannelKey } from "../runtime/contracts";
import { MemoryScope, MemoryType, type MemoryAgentConfig, type MemoryRecord } from "./types";

const MEMORY_TABLE = "yesimbot.memory";

/**
 * Create ai-sdk compatible memory management tools for the memory agent.
 * All tools operate on the yesimbot.memory database table, scoped to the current channel.
 */
export function createMemoryTools(
  ctx: Context,
  channelKey: ChannelKey,
  platform: string,
  config: MemoryAgentConfig,
) {
  const logger = ctx.logger("memory-agent.tools");

  const createMemory = tool({
    description:
      "Create a new memory entry. Use this to record important information about users, events, channel characteristics, or your own experiences.",
    inputSchema: z.object({
      type: z.nativeEnum(MemoryType).describe("Memory category"),
      scope: z.nativeEnum(MemoryScope).describe("Visibility scope"),
      scopeId: z
        .string()
        .describe("User ID (for user scope) or channel key (for channel/private scope)"),
      content: z.string().describe("Memory content text"),
      importance: z.number().int().min(0).max(100).describe("Importance score 0-100"),
    }),
    execute: async ({ type, scope, scopeId, content, importance }) => {
      const id = Random.id();
      const now = new Date();
      await ctx.database.create(MEMORY_TABLE, {
        id,
        type,
        scope,
        scopeId,
        platform,
        content,
        importance,
        isCore: false,
        createdAt: now,
        updatedAt: now,
      });
      logger.debug(`Created memory ${id}: type=${type}, scope=${scope}`);
      return { success: true, id };
    },
  });

  const updateMemory = tool({
    description:
      "Update an existing memory's content and/or importance. Use this when information has changed or you want to refine a memory.",
    inputSchema: z.object({
      id: z.string().describe("Memory ID to update"),
      content: z.string().optional().describe("New content text"),
      importance: z.number().int().min(0).max(100).optional().describe("New importance score"),
    }),
    execute: async ({ id, content, importance }) => {
      const updates: Partial<MemoryRecord> = { updatedAt: new Date() };
      if (content !== undefined) updates.content = content;
      if (importance !== undefined) updates.importance = importance;
      await ctx.database.set(MEMORY_TABLE, { id }, updates);
      logger.debug(`Updated memory ${id}`);
      return { success: true };
    },
  });

  const deleteMemory = tool({
    description:
      "Delete an obsolete or incorrect memory. Use this when information is no longer relevant or was wrong.",
    inputSchema: z.object({
      id: z.string().describe("Memory ID to delete"),
    }),
    execute: async ({ id }) => {
      await ctx.database.remove(MEMORY_TABLE, { id });
      logger.debug(`Deleted memory ${id}`);
      return { success: true };
    },
  });

  const mergeMemories = tool({
    description:
      "Merge multiple related memories into a single consolidated memory. Deletes the source memories and creates a new one with the merged content.",
    inputSchema: z.object({
      sourceIds: z.array(z.string()).min(2).describe("IDs of memories to merge"),
      mergedContent: z.string().describe("Consolidated content for the merged memory"),
      importance: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe("Importance score for the merged memory"),
    }),
    execute: async ({ sourceIds, mergedContent, importance }) => {
      // Fetch first source to inherit type/scope/scopeId
      const sources = await ctx.database.get(MEMORY_TABLE, { id: { $in: sourceIds } });
      if (sources.length === 0) {
        return { success: false, error: "No source memories found" };
      }

      const first = sources[0];
      const newId = Random.id();
      const now = new Date();

      // Delete all source memories
      await ctx.database.remove(MEMORY_TABLE, { id: { $in: sourceIds } });

      // Create merged memory
      await ctx.database.create(MEMORY_TABLE, {
        id: newId,
        type: first.type as MemoryType,
        scope: first.scope as MemoryScope,
        scopeId: first.scopeId,
        platform: first.platform,
        content: mergedContent,
        importance,
        isCore: false,
        createdAt: now,
        updatedAt: now,
      });

      logger.debug(`Merged ${sourceIds.length} memories into ${newId}`);
      return { success: true, newId };
    },
  });

  const setCoreMemory = tool({
    description:
      "Mark or unmark a memory as 'core' (always included in context). Core memories have a total character budget limit. Use sparingly for the most important persistent information.",
    inputSchema: z.object({
      id: z.string().describe("Memory ID"),
      isCore: z.boolean().describe("Whether to mark as core memory"),
    }),
    execute: async ({ id, isCore }) => {
      await ctx.database.set(MEMORY_TABLE, { id }, { isCore, updatedAt: new Date() });

      // Calculate total core memory budget usage
      const coreMemories = await ctx.database.get(MEMORY_TABLE, { isCore: true, platform });
      const totalCoreChars = coreMemories.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);

      logger.debug(
        `Set memory ${id} isCore=${isCore}, total core budget: ${totalCoreChars}/${config.coreMemoryBudget}`,
      );
      return { success: true, totalCoreBudget: totalCoreChars };
    },
  });

  const queryMemories = tool({
    description:
      "Search existing memories for this channel/scope. Use this to review what memories already exist before creating or updating.",
    inputSchema: z.object({
      type: z.nativeEnum(MemoryType).optional().describe("Filter by memory type"),
      scope: z.nativeEnum(MemoryScope).optional().describe("Filter by scope"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
    }),
    execute: async ({ type, scope, limit }) => {
      const query: Record<string, unknown> = { platform };

      // Auto-scope to current channel context
      if (scope) {
        query.scope = scope;
      }
      if (type) {
        query.type = type;
      }

      const memories = await ctx.database
        .select(MEMORY_TABLE)
        .where(query)
        .orderBy("importance", "desc")
        .limit(limit ?? 20)
        .execute();

      return {
        memories: memories.map((m) => ({
          id: m.id,
          type: m.type,
          scope: m.scope,
          scopeId: m.scopeId,
          content: m.content,
          importance: m.importance,
          isCore: m.isCore,
        })),
      };
    },
  });

  return {
    createMemory,
    updateMemory,
    deleteMemory,
    mergeMemories,
    setCoreMemory,
    queryMemories,
  };
}
