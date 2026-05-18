// core/src/extension/chat-history/tools/search-user-activity.ts
import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod";

import { ChannelResolver } from "../engine/channel-resolver.js";
import { FileScanner } from "../engine/file-scanner.js";
import { extractSnippet } from "../engine/result-formatter.js";
import type {
  ChatHistoryConfig,
  ChannelLocator,
  SearchContext,
  SearchUserActivityInput,
  SearchUserActivityOutput,
  UserActivityChannel,
} from "../types.js";

export function createSearchUserActivityTool(
  config: ChatHistoryConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition<SearchUserActivityInput, Promise<SearchUserActivityOutput>> {
  const ctx: SearchContext = {
    sessionsDir: config.sessionsDir,
    isolation: config.isolation,
    currentChannel,
    defaultLimit: config.defaultLimit,
    maxLimit: config.maxLimit,
  };

  return {
    name: "search_user_activity",
    description: "查看某用户在各频道的活动记录和近期发言。",
    promptSnippet: "查看用户活动记录",
    inputSchema: z.object({
      user: z.string().describe("用户ID或昵称"),
      query: z.string().optional().describe("进一步按内容过滤"),
      since: z.string().optional().describe("起始日期 (ISO格式)"),
      until: z.string().optional().describe("截止日期 (ISO格式)"),
      limit: z.number().int().positive().optional().describe("返回频道数上限，默认10，最大30"),
    }),

    async execute(input: SearchUserActivityInput): Promise<SearchUserActivityOutput> {
      const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);

      const resolver = new ChannelResolver(ctx);
      const where = ctx.isolation ? "here" : "all";
      const channelsOrError = await resolver.resolve(where);

      if ("error" in channelsOrError) {
        return { activities: [], hint: channelsOrError.hint ?? channelsOrError.error };
      }

      const scanner = new FileScanner(ctx);
      const userLower = input.user.toLowerCase();

      const results = await scanner.scan(channelsOrError, {
        senderMatcher: (speaker) => speaker.toLowerCase().includes(userLower),
        contentMatcher: input.query
          ? (content) => content.toLowerCase().includes(input.query!.toLowerCase())
          : undefined,
        since: input.since ? new Date(input.since).getTime() : undefined,
        until: input.until ? new Date(input.until).getTime() : undefined,
      });

      if (results.length === 0) {
        return {
          activities: [],
          hint: `未找到用户 "${input.user}" 的活动记录。请检查用户名是否正确，或扩大搜索时间范围。`,
        };
      }

      // Group by channel
      const byChannel = new Map<string, typeof results>();
      for (const r of results) {
        const existing = byChannel.get(r.channelKey) ?? [];
        existing.push(r);
        byChannel.set(r.channelKey, existing);
      }

      // Build activity summaries
      const activities: UserActivityChannel[] = [];
      for (const [channelKey, messages] of byChannel) {
        messages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const recentMessages = messages.slice(0, 3).map((m) => ({
          id: m.id,
          time: m.timestamp,
          snippet: extractSnippet(m.content, input.query ?? input.user),
        }));

        activities.push({
          channel: channelKey,
          last_active: messages[0].timestamp,
          message_count: messages.length,
          recent_messages: recentMessages,
        });
      }

      // Sort activities by last_active desc, limit
      activities.sort(
        (a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime(),
      );

      return { activities: activities.slice(0, limit) };
    },
  };
}
