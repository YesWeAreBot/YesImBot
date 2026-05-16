import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { FilteredStats, JsonlFilter, ParsedEntry } from "./types.js";

/**
 * 从 message.content 数组中提取文本部分
 */
export function extractTextContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

/**
 * 详细解析单行 JSONL，返回 { entry } 或 { skipped: reason }
 */
export function parseJsonlLineDetailed(
  line: string,
):
  | { entry: ParsedEntry }
  | { skipped: "toolCall" | "toolResult" | "sessionInfo" | "malformed" | "emptyText" } {
  const trimmed = line.trim();
  if (!trimmed) return { skipped: "emptyText" };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { skipped: "malformed" };
  }

  if (obj.type === "session_info") return { skipped: "sessionInfo" };

  if (obj.type === "session") {
    return {
      entry: {
        timestamp: String(obj.timestamp ?? ""),
        type: "session",
        content: `Session started: ${obj.id ?? ""}`,
        sessionId: typeof obj.id === "string" ? obj.id : undefined,
      },
    };
  }

  if (obj.type === "custom_message" && obj.customType === "athena:message") {
    const details = (obj.details ?? {}) as Record<string, unknown>;
    return {
      entry: {
        timestamp: String(obj.timestamp ?? ""),
        type: "user",
        senderId: typeof details.senderId === "string" ? details.senderId : undefined,
        content: String(obj.content ?? "").slice(0, 500),
      },
    };
  }

  if (obj.type === "message") {
    const message = (obj.message ?? {}) as Record<string, unknown>;
    const role = message.role;
    const content = Array.isArray(message.content) ? message.content : [];
    if (role === "tool") return { skipped: "toolResult" };
    if (
      role === "assistant" &&
      content.some((part: { type: string }) => part.type === "tool-call")
    ) {
      return { skipped: "toolCall" };
    }
    const text = extractTextContent(content);
    if (!text) return { skipped: "emptyText" };
    return {
      entry: {
        timestamp: String(obj.timestamp ?? ""),
        type: "assistant",
        content: text.slice(0, 500),
      },
    };
  }

  return { skipped: "emptyText" };
}

/**
 * 扫描 JSONL 文件，返回过滤后的 entries 和统计信息
 */
export async function scanJsonlFile(
  filePath: string,
  filter: JsonlFilter,
): Promise<{ entries: ParsedEntry[]; filtered: FilteredStats }> {
  const filtered: FilteredStats = {
    toolCall: 0,
    toolResult: 0,
    sessionInfo: 0,
    malformed: 0,
    emptyText: 0,
  };
  const entries: ParsedEntry[] = [];

  for await (const line of createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
  })) {
    const parsed = parseJsonlLineDetailed(line);
    if ("skipped" in parsed) {
      filtered[parsed.skipped] += 1;
      continue;
    }

    const entry = parsed.entry;
    if (filter.messageTypes && !filter.messageTypes.has(entry.type)) continue;
    if (filter.senderId && entry.senderId !== filter.senderId) continue;
    if (filter.senderMatcher && !filter.senderMatcher(entry.senderId)) continue;
    if (filter.contentMatcher && !filter.contentMatcher(entry.content)) continue;

    if (filter.since || filter.until) {
      const ts = new Date(entry.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (filter.since && ts < filter.since) continue;
      if (filter.until && ts > filter.until) continue;
    }

    entries.push(entry);
  }

  return { entries, filtered };
}

/**
 * 在已解析 entries 中按锚点截取窗口
 */
export async function readJsonlWindow(
  filePath: string,
  options: {
    anchorTimestamp?: string;
    anchorQuery?: string;
    before: number;
    after: number;
    messageTypes?: Set<"user" | "assistant" | "session">;
  },
): Promise<{
  anchorFound: boolean;
  window: ParsedEntry[];
  truncated: { before: boolean; after: boolean; content: boolean };
}> {
  const { entries } = await scanJsonlFile(filePath, { messageTypes: options.messageTypes });
  const anchorIndex = entries.findIndex((entry) => {
    if (options.anchorTimestamp) return entry.timestamp === options.anchorTimestamp;
    if (options.anchorQuery) return entry.content.includes(options.anchorQuery);
    return false;
  });

  if (anchorIndex < 0) {
    return {
      anchorFound: false,
      window: [],
      truncated: { before: false, after: false, content: false },
    };
  }

  const start = Math.max(0, anchorIndex - options.before);
  const end = Math.min(entries.length, anchorIndex + options.after + 1);

  return {
    anchorFound: true,
    window: entries.slice(start, end),
    truncated: {
      before: start > 0,
      after: end < entries.length,
      content: false,
    },
  };
}
