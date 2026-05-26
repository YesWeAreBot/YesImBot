import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { ToolDefinition } from "../../../../../internal/extension/types.js";
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
// 全局输出字符数硬限制，防止上下文溢出；超出时按时间分组整体截断
const MAX_OUTPUT_CHARS = 2000;

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

/**
 * 预估单个时间分组格式化后的字符数（用于截断判断）
 */
function formatGroupText(messages: ScanResult[], hitIds: Set<string>): string {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const lines: string[] = [];

  const startTime = formatTimestamp(sorted[0].timestamp);
  const endTime = formatTimestamp(sorted[sorted.length - 1].timestamp);
  if (sorted.length === 1 || startTime === endTime) {
    lines.push(`### ${startTime}`);
  } else {
    lines.push(`### ${startTime} ~ ${endTime}`);
  }

  for (const msg of sorted) {
    const isHit = hitIds.has(msg.id);
    lines.push(formatMessageLine(msg, isHit, false));
  }
  lines.push("");
  return lines.join("\n");
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
    promptSnippet: `查看用户在各频道/私聊中的活动记录。`,
    inputSchema: z.object({
      user: z.string().describe("用户ID或昵称"),
      query: z.string().optional().describe("进一步按内容过滤"),
      since: z.string().optional().describe("起始日期 (ISO格式)"),
      until: z.string().optional().describe("截止日期 (ISO格式)"),
      limit: z.number().int().positive().optional().describe("返回命中消息数上限，默认10，最大30"),
    }),

    async execute(input: SearchUserActivityInput): Promise<SearchUserActivityOutput> {
      const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);

      const resolver = new ChannelResolver(ctx);
      const where = ctx.isolation ? "here" : "all";
      const channelsOrError = await resolver.resolve(where, { maxChannels: config.maxLimit });

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
      const sinceMs = input.since
        ? new Date(input.since).getTime()
        : Date.now() - 30 * 24 * 60 * 60 * 1000; // 默认最近30天
      const untilMs = input.until ? new Date(input.until).getTime() : undefined;

      // 用户匹配函数
      const userMatcher = (msg: { speaker: string; actorId?: string; actorName?: string }) =>
        msg.speaker.toLowerCase().includes(userLower) ||
        !!msg.actorId?.toLowerCase().includes(userLower) ||
        !!msg.actorName?.toLowerCase().includes(userLower);

      // 内容匹配函数
      const contentMatcher = input.query
        ? (content: string) => content.toLowerCase().includes(input.query!.toLowerCase())
        : undefined;

      // ========== 第一阶段：反向扫描定位命中频道 ==========
      // 每频道限制扫描量，反向优先最新消息，快速定位哪些频道包含目标用户
      const PER_CHANNEL_USER_HITS = limit * 10;

      const userHits = await scanner.scan(channelsWithSession, {
        reverse: true,
        senderMatcher: (msg) => userMatcher(msg),
        contentMatcher,
        since: sinceMs,
        until: untilMs,
        maxHits: PER_CHANNEL_USER_HITS * channelsWithSession.length,
        maxLines: PER_CHANNEL_USER_HITS,
      });

      if (userHits.length === 0) {
        return {
          text: "",
          hint: `未找到用户 "${input.user}" 的活动记录。请检查用户名是否正确，或扩大搜索时间范围。`,
        };
      }

      // 提取包含命中消息的频道集合
      const hitChannelKeys = new Set(userHits.map((m) => m.channelKey));

      // ========== 第二阶段：正向扫描命中频道获取完整上下文 ==========
      const hitChannels = channelsWithSession.filter((ch) => hitChannelKeys.has(ch.channelKey));
      // 不设 maxHits 上限——命中频道数量少（通常 1-3 个），需要完整上下文
      const contextMessages = await scanner.scan(hitChannels, {
        since: sinceMs,
        until: untilMs,
        maxHits: config.maxLimit * 500,
      });

      // 构建命中 ID 集合（从第一阶段）
      const hitIds = new Set(userHits.map((m) => m.id));

      // 按频道分组上下文消息
      const byChannel = new Map<string, ScanResult[]>();
      for (const msg of contextMessages) {
        const existing = byChannel.get(msg.channelKey) ?? [];
        existing.push(msg);
        byChannel.set(msg.channelKey, existing);
      }

      // ========== 第三阶段：构建时间分组并截断输出 ==========

      // 3a. 为每个频道提取命中消息和上下文，构建时间分组
      interface TimeGroup {
        channelKey: string;
        messages: ScanResult[];
        hitCount: number; // 该分组内命中消息数
        latestHitTimestamp: number; // 该分组内最新命中消息时间戳
        earliestHitTimestamp: number; // 该分组内最早命中消息时间戳
      }

      const allGroups: TimeGroup[] = [];

      for (const channelKey of hitChannelKeys) {
        const messages = byChannel.get(channelKey) ?? [];
        const channelHitIds = new Set<string>();
        for (const msg of messages) {
          if (hitIds.has(msg.id)) channelHitIds.add(msg.id);
        }
        for (const msg of userHits) {
          if (msg.channelKey === channelKey) channelHitIds.add(msg.id);
        }
        if (channelHitIds.size === 0) continue;

        // 提取上下文
        const contextIds = new Set<string>();
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
            contextIds.add(msg.id);
            contextCount++;
          }
        }

        // 合并命中和上下文消息，按时间排序
        const relevantIds = new Set([...channelHitIds, ...contextIds]);
        const relevantMessages = sortedMessages.filter((m) => relevantIds.has(m.id));

        // 按 CONTEXT_WINDOW_MS 间隔分组
        let groupStart = 0;
        let lastTime = relevantMessages[0]?.timestamp ?? 0;

        for (let i = 0; i < relevantMessages.length; i++) {
          if (i > 0 && relevantMessages[i].timestamp - lastTime > CONTEXT_WINDOW_MS) {
            const groupMsgs = relevantMessages.slice(groupStart, i);
            const groupHits = groupMsgs.filter((m) => hitIds.has(m.id));
            if (groupHits.length > 0) {
              allGroups.push({
                channelKey,
                messages: groupMsgs,
                hitCount: groupHits.length,
                latestHitTimestamp: Math.max(...groupHits.map((m) => m.timestamp)),
                earliestHitTimestamp: Math.min(...groupHits.map((m) => m.timestamp)),
              });
            }
            groupStart = i;
          }
          lastTime = relevantMessages[i].timestamp;
        }
        // 最后一个分组
        if (groupStart < relevantMessages.length) {
          const groupMsgs = relevantMessages.slice(groupStart);
          const groupHits = groupMsgs.filter((m) => hitIds.has(m.id));
          if (groupHits.length > 0) {
            allGroups.push({
              channelKey,
              messages: groupMsgs,
              hitCount: groupHits.length,
              latestHitTimestamp: Math.max(...groupHits.map((m) => m.timestamp)),
              earliestHitTimestamp: Math.min(...groupHits.map((m) => m.timestamp)),
            });
          }
        }
      }

      // 3b. 全局按最新命中时间降序排列，从新到旧逐个纳入
      allGroups.sort((a, b) => b.latestHitTimestamp - a.latestHitTimestamp);

      const acceptedGroups: TimeGroup[] = [];
      let totalHits = 0;
      let totalChars = 0;
      let truncated = false;

      for (const group of allGroups) {
        // 检查 limit（仅计命中消息数）
        if (totalHits + group.hitCount > limit) {
          truncated = true;
          break;
        }
        // 预估该分组格式化后的字符数
        const groupText = formatGroupText(group.messages, hitIds);
        if (totalChars + groupText.length > MAX_OUTPUT_CHARS) {
          truncated = true;
          break;
        }
        acceptedGroups.push(group);
        totalHits += group.hitCount;
        totalChars += groupText.length;
      }

      // 3c. 按频道重新分组，保持频道内时间连续（从早到晚）
      const groupsByChannel = new Map<string, TimeGroup[]>();
      for (const group of acceptedGroups) {
        const list = groupsByChannel.get(group.channelKey) ?? [];
        list.push(group);
        groupsByChannel.set(group.channelKey, list);
      }

      // 频道按其最新命中时间降序排列
      const channelOrder = [...groupsByChannel.entries()].sort((a, b) => {
        const aMax = Math.max(...a[1].map((g) => g.latestHitTimestamp));
        const bMax = Math.max(...b[1].map((g) => g.latestHitTimestamp));
        return bMax - aMax;
      });

      const channelTexts: string[] = [];
      for (const [channelKey, groups] of channelOrder) {
        // 频道内分组按时间从早到晚
        groups.sort((a, b) => a.earliestHitTimestamp - b.earliestHitTimestamp);

        const channelInfo = channelsWithSession.find((c) => c.channelKey === channelKey);
        const platform = channelInfo?.platform ?? "unknown";
        const channelId = channelInfo?.channelId ?? channelKey;
        const channelType = channelInfo?.type ?? "unknown";
        const channelLabel = `${platform}:${channelId}`;

        const lines: string[] = [];
        lines.push(`## ${channelLabel} (${channelType})`);
        lines.push("");

        for (const group of groups) {
          const sorted = [...group.messages].sort((a, b) => a.timestamp - b.timestamp);
          const startTime = formatTimestamp(sorted[0].timestamp);
          const endTime = formatTimestamp(sorted[sorted.length - 1].timestamp);

          if (sorted.length === 1 || startTime === endTime) {
            lines.push(`### ${startTime}`);
          } else {
            lines.push(`### ${startTime} ~ ${endTime}`);
          }

          for (const msg of sorted) {
            const isHit = hitIds.has(msg.id);
            lines.push(formatMessageLine(msg, isHit, false));
          }
          lines.push("");
        }

        channelTexts.push(lines.join("\n"));
      }

      // 3d. 构建 hint
      let hint: string | undefined;
      if (truncated && acceptedGroups.length > 0) {
        // 取被保留结果中最早命中消息的时间戳
        const earliestKept = Math.min(...acceptedGroups.map((g) => g.earliestHitTimestamp));
        const earliestTime = new Date(earliestKept).toISOString();
        hint = `还有更早的匹配消息未显示，可设置 until=${earliestTime} 继续查询。`;
      } else if (truncated) {
        hint = `匹配消息过多，请缩小时间范围重试。`;
      }

      return {
        text: channelTexts.join("\n---\n\n"),
        hint,
      };
    },
  };
}
