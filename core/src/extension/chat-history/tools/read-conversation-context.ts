// core/src/extension/chat-history/tools/read-conversation-context.ts
import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod";

import { listChannelSummaries, listSessionFiles } from "../channel-store.js";
import { formatCompactLine } from "../engine/result-formatter.js";
import { scanJsonlFile } from "../jsonl-parser.js";
import type {
  ChatHistoryConfig,
  ChannelLocator,
  ReadConversationContextInput,
  ReadConversationContextOutput,
  SearchContext,
} from "../types.js";

const MAX_BEFORE = 20;
const MAX_AFTER = 20;

export function createReadConversationContextTool(
  config: ChatHistoryConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition<ReadConversationContextInput, Promise<ReadConversationContextOutput>> {
  const ctx: SearchContext = {
    sessionsDir: config.sessionsDir,
    isolation: config.isolation,
    currentChannel,
    defaultLimit: config.defaultLimit,
    maxLimit: config.maxLimit,
  };

  return {
    name: "read_conversation_context",
    description: "展开搜索结果附近的对话上下文。传入消息 id，返回前后的对话内容。",
    promptSnippet: "展开对话上下文",
    inputSchema: z.object({
      id: z.string().describe("来自搜索结果的消息 ID"),
      before: z.number().int().nonnegative().optional().describe("锚点前取多少条，默认5，上限20"),
      after: z.number().int().nonnegative().optional().describe("锚点后取多少条，默认5，上限20"),
    }),

    async execute(input: ReadConversationContextInput): Promise<ReadConversationContextOutput> {
      const before = Math.min(input.before ?? 5, MAX_BEFORE);
      const after = Math.min(input.after ?? 5, MAX_AFTER);
      const targetId = input.id;

      const channels =
        ctx.isolation && ctx.currentChannel
          ? [ctx.currentChannel]
          : await listChannelSummaries(ctx.sessionsDir);

      for (const channel of channels) {
        const channelKey = channel.channelKey;

        if (ctx.isolation && ctx.currentChannel && channelKey !== ctx.currentChannel.channelKey) {
          continue;
        }

        const files = await listSessionFiles(ctx.sessionsDir, channelKey);
        files.sort((a, b) => b.modified.getTime() - a.modified.getTime());

        for (const file of files) {
          const allMessages = await scanJsonlFile(file.fullPath, { maxLines: 5000 });
          const anchorIndex = allMessages.findIndex((m) => m.id === targetId);

          if (anchorIndex < 0) continue;

          const start = Math.max(0, anchorIndex - before);
          const end = Math.min(allMessages.length, anchorIndex + after + 1);
          const window = allMessages.slice(start, end);

          const messages = window.map((msg, i) => {
            const isAnchor = start + i === anchorIndex;
            return formatCompactLine(msg, isAnchor);
          });

          return {
            messages,
            anchor_index: anchorIndex - start,
            first_id: window[0].id,
            last_id: window[window.length - 1].id,
            has_more_before: start > 0,
            has_more_after: end < allMessages.length,
          };
        }
      }

      return {
        messages: [],
        anchor_index: -1,
        first_id: "",
        last_id: "",
        has_more_before: false,
        has_more_after: false,
        hint: `未找到消息 ID "${targetId}"。该消息可能已被清理或不在可访问范围内。`,
      };
    },
  };
}
