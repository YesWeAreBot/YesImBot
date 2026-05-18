import type { SearchConversationOutput, SearchResult } from "../types.js";

interface ScanResult {
  id: string;
  timestamp: string;
  role: "user" | "assistant";
  speaker: string;
  content: string;
  channelKey: string;
}

const SNIPPET_RADIUS = 200;
const MAX_COMPACT_CONTENT = 1000;
const DEDUP_INTERVAL_MS = 60_000;

export function extractSnippet(content: string, query: string): string {
  if (content.length <= 400) return content;

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);

  if (idx < 0) {
    return content.slice(0, 400) + "…";
  }

  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(content.length, idx + lowerQuery.length + SNIPPET_RADIUS);
  let snippet = content.slice(start, end);

  if (start > 0) snippet = "…" + snippet;
  if (end < content.length) snippet = snippet + "…";

  return snippet;
}

export function deduplicateResults(results: ScanResult[]): {
  deduped: ScanResult[];
  totalFound: number;
} {
  if (results.length === 0) return { deduped: [], totalFound: 0 };

  const deduped: ScanResult[] = [results[0]];

  for (let i = 1; i < results.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = results[i];

    if (curr.channelKey !== prev.channelKey) {
      deduped.push(curr);
      continue;
    }

    const prevTs = new Date(prev.timestamp).getTime();
    const currTs = new Date(curr.timestamp).getTime();

    if (Math.abs(currTs - prevTs) >= DEDUP_INTERVAL_MS) {
      deduped.push(curr);
    }
  }

  return { deduped, totalFound: results.length };
}

export function formatCompactLine(
  msg: { timestamp: string; role: string; speaker: string; content: string },
  isAnchor: boolean,
): string {
  const time = msg.timestamp.replace("T", " ").replace(/:\d{2}\.\d+Z$|:\d{2}Z$/, "").slice(0, 16);
  const content = msg.content.length > MAX_COMPACT_CONTENT
    ? msg.content.slice(0, MAX_COMPACT_CONTENT) + "…"
    : msg.content;

  const rolePrefix = msg.role === "assistant"
    ? "assistant"
    : `user ${msg.speaker}`;

  const line = `[${time}] ${rolePrefix}: ${content}`;
  return isAnchor ? `>>> ${line}` : line;
}

export function formatSearchResults(
  results: ScanResult[],
  query: string,
  limit: number,
  showChannel: boolean,
): SearchConversationOutput {
  const sorted = [...results].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const limited = sorted.slice(0, limit);

  const formattedResults: SearchResult[] = limited.map((r) => ({
    id: r.id,
    time: r.timestamp,
    speaker: r.speaker,
    snippet: extractSnippet(r.content, query),
    ...(showChannel ? { channel: r.channelKey } : {}),
  }));

  return {
    results: formattedResults,
    total_found: results.length,
    ...(results.length === 0
      ? { hint: "未找到匹配结果。尝试换个关键词、扩大时间范围、或使用 where=\"all\" 跨频道搜索。" }
      : results.length > limit
        ? { hint: `共找到 ${results.length} 条结果，已返回最近 ${limit} 条。可缩小时间范围获取更精确的结果。` }
        : {}),
  };
}
