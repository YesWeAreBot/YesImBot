import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { JsonlFilter, ParsedEntry } from "./types";

const MAX_CONTENT_LENGTH = 500;

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
 * 解析单行 JSONL，返回 ParsedEntry 或 null（应过滤的行）
 *
 * 过滤规则：
 * - tool-call → null
 * - tool-result → null
 * - session_info → null
 * - 畸形 JSON → null
 * - 空行 → null
 */
export function parseJsonlLine(line: string): ParsedEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = obj.type as string;
  const timestamp = (obj.timestamp as string) ?? "";

  // session header
  if (type === "session") {
    return {
      timestamp,
      type: "session",
      content: `Session started: ${obj.id ?? ""}`,
      sessionId: obj.id as string,
    };
  }

  // session_info — skip
  if (type === "session_info") {
    return null;
  }

  // custom_message (user messages, e.g. athena:message)
  if (type === "custom_message" && obj.customType === "athena:message") {
    const content = String(obj.content ?? "");
    const details = (obj.details ?? {}) as Record<string, unknown>;
    return {
      timestamp,
      type: "user",
      sender: details.senderId as string | undefined,
      content:
        content.length > MAX_CONTENT_LENGTH
          ? content.slice(0, MAX_CONTENT_LENGTH) + "..."
          : content,
    };
  }

  // message (assistant / tool)
  if (type === "message") {
    const msg = (obj.message ?? {}) as Record<string, unknown>;
    const role = msg.role as string;
    const contentArr = msg.content;

    if (!Array.isArray(contentArr)) return null;

    // tool result — skip
    if (role === "tool") return null;

    // assistant message
    if (role === "assistant") {
      const hasToolCall = contentArr.some((p) => p.type === "tool-call");
      if (hasToolCall) return null;

      const text = extractTextContent(contentArr);
      if (!text) return null;

      return {
        timestamp,
        type: "assistant",
        content:
          text.length > MAX_CONTENT_LENGTH ? text.slice(0, MAX_CONTENT_LENGTH) + "..." : text,
      };
    }
  }

  return null;
}

/**
 * 流式读取 JSONL 文件，逐行解析并应用过滤器
 */
export async function* streamJsonl(
  filePath: string,
  filter: JsonlFilter,
): AsyncGenerator<ParsedEntry> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const entry = parseJsonlLine(line);
    if (!entry) continue;

    // 消息类型过滤
    if (filter.messageTypes && !filter.messageTypes.has(entry.type)) continue;

    // 用户过滤
    if (filter.user && entry.sender !== filter.user) continue;

    // 时间范围过滤
    if (filter.since || filter.until) {
      const ts = new Date(entry.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (filter.since && ts < filter.since) continue;
      if (filter.until && ts > filter.until) continue;
    }

    // 关键词过滤
    if (filter.keyword && !filter.keyword.test(entry.content)) continue;

    yield entry;
  }
}
