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
    // const showTime = timeSpan > 60_000; // 超过1分钟显示时间
    const showTime = false; // 统一不显示时间，避免过于冗长

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
    promptSnippet: `查看用户在各频道/私聊中的活动记录。`,
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

      // ========== 第三阶段：格式化输出 ==========
      const channelTexts: string[] = [];
      let processedChannels = 0;

      for (const channelKey of hitChannelKeys) {
        if (processedChannels >= limit) break;

        const messages = byChannel.get(channelKey) ?? [];
        const channelHitIds = new Set<string>();
        for (const msg of messages) {
          if (hitIds.has(msg.id)) {
            channelHitIds.add(msg.id);
          }
        }
        // 也包含第一阶段扫描到但第二阶段可能未覆盖的命中
        for (const msg of userHits) {
          if (msg.channelKey === channelKey) channelHitIds.add(msg.id);
        }

        if (channelHitIds.size === 0) continue;

        // 获取频道元信息
        const channelInfo = channelsWithSession.find((c) => c.channelKey === channelKey);
        const platform = channelInfo?.platform ?? "unknown";
        const channelId = channelInfo?.channelId ?? channelKey;
        const channelType = channelInfo?.type ?? "unknown";
        const channelLabel = `${platform}:${channelId}`;

        // 提取上下文：为每个命中消息获取前后5分钟的消息
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

        // 合并命中消息和上下文消息
        const relevantIds = new Set([...channelHitIds, ...contextIds]);
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
