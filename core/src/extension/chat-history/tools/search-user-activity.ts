// core/src/extension/chat-history/tools/search-user-activity.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod";

import { ChannelResolver } from "../engine/channel-resolver.js";
import { FileScanner, type ScanResult } from "../engine/file-scanner.js";
import { formatTimestamp } from "../engine/result-formatter.js";
import type {
  ChatHistoryConfig,
  ChannelLocator,
  SearchContext,
  SearchUserActivityInput,
  SearchUserActivityOutput,
} from "../types.js";

// 时间段分组常量
const CONTEXT_WINDOW_MS = 5 * 60 * 1000; // 前后5分钟
const MAX_CONTEXT_MESSAGES = 5; // 每个时间段最多5条上下文
const MAX_SNIPPET_LENGTH = 150; // 消息摘要最大长度

/**
 * 截取消息摘要
 */
function truncateSnippet(content: string): string {
  if (content.length <= MAX_SNIPPET_LENGTH) return content;
  return content.slice(0, MAX_SNIPPET_LENGTH) + "…";
}

/**
 * 格式化单条消息行
 */
function formatMessageLine(
  msg: ScanResult,
  isHit: boolean,
  showTime: boolean,
  timeStr?: string,
): string {
  const time = timeStr ?? formatTimestamp(msg.timestamp);
  const speaker = msg.role === "assistant" ? "assistant" : msg.speaker;
  const snippet = truncateSnippet(msg.content);
  const prefix = isHit ? ">>>" : "   ";
  return showTime
    ? `${prefix} [${time}] ${speaker}: ${snippet}`
    : `${prefix} ${speaker}: ${snippet}`;
}

/**
 * 将消息按时间段分组，返回格式化的文本
 */
function formatChannelActivity(
  channelLabel: string,
  channelType: string,
  allMessages: ScanResult[],
  hitIds: Set<string>,
): string {
  if (allMessages.length === 0) return "";

  // 按时间排序（从早到晚）
  const sorted = [...allMessages].sort((a, b) => a.timestamp - b.timestamp);

  const lines: string[] = [];
  lines.push(`## ${channelLabel} (${channelType})`);
  lines.push("");

  // 按时间段分组
  let groupStart = 0;
  let lastTime = sorted[0].timestamp;

  const flushGroup = (startIdx: number, endIdx: number) => {
    const group = sorted.slice(startIdx, endIdx + 1);
    if (group.length === 0) return;

    const startTime = formatTimestamp(group[0].timestamp);
    const endTime = formatTimestamp(group[group.length - 1].timestamp);

    if (group.length === 1 || startTime === endTime) {
      lines.push(`### ${startTime}`);
    } else {
      lines.push(`### ${startTime} ~ ${endTime}`);
    }

    // 判断是否需要显示时间（组内消息跨度较大时显示）
    const timeSpan = group[group.length - 1].timestamp - group[0].timestamp;
    const showTime = timeSpan > 60_000; // 超过1分钟显示时间

    for (const msg of group) {
      const isHit = hitIds.has(msg.id);
      const timeStr = showTime ? formatTimestamp(msg.timestamp) : undefined;
      lines.push(formatMessageLine(msg, isHit, showTime, timeStr));
    }
    lines.push("");
  };

  for (let i = 0; i < sorted.length; i++) {
    const msg = sorted[i];
    // 如果与上一条消息间隔超过 CONTEXT_WINDOW_MS，开始新分组
    if (i > 0 && msg.timestamp - lastTime > CONTEXT_WINDOW_MS) {
      flushGroup(groupStart, i - 1);
      groupStart = i;
    }
    lastTime = msg.timestamp;
  }
  // 处理最后一个分组
  flushGroup(groupStart, sorted.length - 1);

  return lines.join("\n");
}

/**
 * 从 meta.json 读取当前会话 ID
 */
async function readCurrentSessionId(
  sessionsDir: string,
  channelKey: string,
): Promise<string | undefined> {
  try {
    const metaPath = join(sessionsDir, channelKey, "meta.json");
    const content = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(content) as Record<string, unknown>;
    const currentSession = meta.current_session ?? meta.currentSession;
    return typeof currentSession === "string" ? currentSession.replace(/\.jsonl$/, "") : undefined;
  } catch {
    return undefined;
  }
}

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
    description:
      "查看某用户在各频道/私聊会话中的活动记录。结果按频道分组，每个频道内按时间段聚合，标记直接命中的消息。",
    promptSnippet: `查看用户在各频道/私聊中的活动记录。
- 结果按频道分组，标注频道类型（private/group）
- 每个频道内按时间段聚合消息
- >>> 标记表示直接命中的消息
- 未标记的消息是上下文，帮助理解命中消息`,
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
        return { text: "", hint: channelsOrError.hint ?? channelsOrError.error };
      }

      // 为每个频道读取 currentSessionId
      const channelsWithSession = await Promise.all(
        channelsOrError.map(async (ch) => ({
          ...ch,
          currentSessionId: await readCurrentSessionId(config.sessionsDir, ch.channelKey),
        })),
      );

      const scanner = new FileScanner(ctx);
      const userLower = input.user.toLowerCase();
      const sinceMs = input.since ? new Date(input.since).getTime() : undefined;
      const untilMs = input.until ? new Date(input.until).getTime() : undefined;

      // 第一步：扫描所有消息（不过滤用户），获取完整上下文
      const allMessages = await scanner.scan(channelsWithSession, {
        since: sinceMs,
        until: untilMs,
      });

      // 第二步：标记哪些消息是命中消息（匹配用户和可选的 query）
      const hitIds = new Set<string>();
      for (const msg of allMessages) {
        const userMatch =
          msg.speaker.toLowerCase().includes(userLower) ||
          !!msg.actorId?.toLowerCase().includes(userLower) ||
          !!msg.actorName?.toLowerCase().includes(userLower);

        if (!userMatch) continue;

        if (input.query) {
          const contentLower = msg.content.toLowerCase();
          if (!contentLower.includes(input.query.toLowerCase())) continue;
        }

        hitIds.add(msg.id);
      }

      if (hitIds.size === 0) {
        return {
          text: "",
          hint: `未找到用户 "${input.user}" 的活动记录。请检查用户名是否正确，或扩大搜索时间范围。`,
        };
      }

      // 第三步：按频道分组，每个频道内提取上下文
      const byChannel = new Map<string, ScanResult[]>();
      for (const msg of allMessages) {
        const existing = byChannel.get(msg.channelKey) ?? [];
        existing.push(msg);
        byChannel.set(msg.channelKey, existing);
      }

      // 只保留包含命中消息的频道，并提取上下文
      const channelTexts: string[] = [];
      let processedChannels = 0;

      for (const [channelKey, messages] of byChannel) {
        if (processedChannels >= limit) break;

        // 检查该频道是否有命中消息
        const channelHitIds = new Set<string>();
        for (const msg of messages) {
          if (hitIds.has(msg.id)) {
            channelHitIds.add(msg.id);
          }
        }

        if (channelHitIds.size === 0) continue;

        // 获取频道元信息
        const channelInfo = channelsWithSession.find((c) => c.channelKey === channelKey);
        const platform = channelInfo?.platform ?? "unknown";
        const channelId = channelInfo?.channelId ?? channelKey;
        const channelType = channelInfo?.type ?? "unknown";
        const channelLabel = `${platform}:${channelId}`;

        // 提取上下文：为每个命中消息获取前后5分钟的消息
        const contextMessages = new Set<string>();
        const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);

        for (const hitId of channelHitIds) {
          const hitMsg = messages.find((m) => m.id === hitId);
          if (!hitMsg) continue;

          const windowStart = hitMsg.timestamp - CONTEXT_WINDOW_MS;
          const windowEnd = hitMsg.timestamp + CONTEXT_WINDOW_MS;

          let contextCount = 0;
          for (const msg of sortedMessages) {
            if (msg.id === hitId) continue;
            if (msg.timestamp < windowStart || msg.timestamp > windowEnd) continue;
            if (contextCount >= MAX_CONTEXT_MESSAGES) break;
            contextMessages.add(msg.id);
            contextCount++;
          }
        }

        // 合并命中消息和上下文消息
        const relevantIds = new Set([...channelHitIds, ...contextMessages]);
        const relevantMessages = messages.filter((m) => relevantIds.has(m.id));

        const text = formatChannelActivity(channelLabel, channelType, relevantMessages, hitIds);
        if (text) {
          channelTexts.push(text);
          processedChannels++;
        }
      }

      return {
        text: channelTexts.join("\n---\n\n"),
      };
    },
  };
}
