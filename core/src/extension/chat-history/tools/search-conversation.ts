// core/src/extension/chat-history/tools/search-conversation.ts
import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod";

import type {
  ChatHistoryConfig,
  ChannelLocator,
  SearchConversationInput,
  SearchConversationOutput,
  SearchContext,
} from "../types.js";
import { validateQuery } from "../engine/query-guard.js";
import { ChannelResolver } from "../engine/channel-resolver.js";
import { FileScanner } from "../engine/file-scanner.js";
import { deduplicateResults, formatSearchResults } from "../engine/result-formatter.js";

export function createSearchConversationTool(
  config: ChatHistoryConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition<SearchConversationInput, Promise<SearchConversationOutput>> {
  const ctx: SearchContext = {
    sessionsDir: config.sessionsDir,
    isolation: config.isolation,
    currentChannel,
    defaultLimit: config.defaultLimit,
    maxLimit: config.maxLimit,
  };

  return {
    name: "search_conversation",
    description: "搜索历史聊天记录。提供关键词搜索当前频道或跨频道的对话内容。",
    promptSnippet: "搜索历史聊天记录",
    inputSchema: z.object({
      query: z.string().describe("搜索关键词或短语"),
      where: z.enum(["here", "all"]).optional().describe("搜索范围，默认 here"),
      user: z.string().optional().describe("按发言者过滤"),
      role: z.enum(["user", "assistant"]).optional().describe("按角色过滤"),
      since: z.string().optional().describe("起始日期 (ISO格式)"),
      until: z.string().optional().describe("截止日期 (ISO格式)"),
      limit: z.number().int().positive().optional().describe("返回条数上限，默认10，最大30"),
    }),

    async execute(input: SearchConversationInput): Promise<SearchConversationOutput> {
      const where = input.where ?? "here";
      const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);

      // Check isolation mode before validation (isolation takes precedence)
      if (where === "all" && ctx.isolation) {
        return {
          results: [],
          total_found: 0,
          hint: "隔离模式下无法跨频道搜索。请使用 where=\"here\" 搜索当前频道。",
        };
      }

      // Validate query
      const validation = validateQuery({
        query: input.query,
        where,
        hasUserFilter: !!input.user,
        hasTimeFilter: !!(input.since || input.until),
      });

      if (!validation.valid) {
        return { results: [], total_found: 0, hint: validation.hint };
      }

      // Resolve channels
      const resolver = new ChannelResolver(ctx);
      const channelsOrError = await resolver.resolve(where);

      if ("error" in channelsOrError) {
        return { results: [], total_found: 0, hint: channelsOrError.hint ?? channelsOrError.error };
      }

      // Build scan options
      const normalizedQuery = validation.normalized!;
      const scanner = new FileScanner(ctx);
      const results = await scanner.scan(channelsOrError, {
        contentMatcher: (content) => content.toLowerCase().includes(normalizedQuery),
        senderMatcher: input.user
          ? (speaker) => speaker.toLowerCase().includes(input.user!.toLowerCase())
          : undefined,
        roleMatcher: input.role ? (role) => role === input.role : undefined,
        since: input.since ? new Date(input.since).getTime() : undefined,
        until: input.until ? new Date(input.until).getTime() : undefined,
        maxHits: limit * 2,
      });

      // Deduplicate
      const { deduped } = deduplicateResults(results);

      // Format
      return formatSearchResults(deduped, normalizedQuery, limit, where === "all");
    },
  };
}
