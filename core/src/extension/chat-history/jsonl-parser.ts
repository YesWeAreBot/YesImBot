// core/src/extension/chat-history/jsonl-parser.ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { ParsedMessage, ScanOptions } from "./types.js";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p: { type: string; text?: string }) => p.type === "text" && p.text)
    .map((p: { text: string }) => p.text)
    .join("");
}

function parseTimestamp(
  obj: Record<string, unknown>,
  details?: Record<string, unknown>,
  message?: Record<string, unknown>,
): number {
  if (details?.timestamp && typeof details.timestamp === "number") {
    if (details.timestamp >= 1e9 && details.timestamp < 1e10) {
      return details.timestamp * 1000;
    }
    return details.timestamp;
  }

  // assistant 消息的时间戳在 message 对象内部
  if (message?.timestamp && typeof message.timestamp === "number") {
    if (message.timestamp >= 1e9 && message.timestamp < 1e10) {
      return message.timestamp * 1000;
    }
    return message.timestamp;
  }

  if (obj.timestamp && typeof obj.timestamp === "string") {
    const ts = new Date(obj.timestamp).getTime();
    if (!Number.isNaN(ts)) return ts;
  }

  return 0;
}

export type ParseResult = ParsedMessage | null | { type: "compaction_marker" };

export function parseJsonlLine(line: string): ParseResult {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = obj.type;

  if (
    type === "session" ||
    type === "session_info" ||
    type === "custom" ||
    type === "thinking_level_change" ||
    type === "model_change" ||
    type === "compaction" ||
    type === "branch_summary"
  ) {
    return null;
  }

  if (type === "custom_message" && obj.customType === "athena:event") {
    const details = (obj.details ?? {}) as Record<string, unknown>;
    if (details.version !== 1) return null;
    if (details.kind !== "chat_message") return null;

    const content = obj.content;
    const text = extractText(content);
    if (!text) return null;

    const actor = details.actor as { id?: string; name?: string } | undefined;
    const speaker = actor?.name ?? actor?.id ?? "unknown";

    const timestamp = parseTimestamp(obj as Record<string, unknown>, details);

    return {
      id: String(details.id ?? obj.id ?? ""),
      timestamp,
      role: "user",
      speaker,
      actorId: actor?.id,
      actorName: actor?.name,
      content: text,
      channelKey: "",
    };
  }

  if (type === "message") {
    const message = (obj.message ?? {}) as Record<string, unknown>;
    const role = message.role;

    if (role === "compactionSummary") {
      return { type: "compaction_marker" };
    }

    if (role === "tool") return null;

    if (role === "assistant") {
      const content = message.content;
      if (!Array.isArray(content)) return null;
      const hasToolCall = content.some((p: { type: string }) => p.type === "tool-call");
      if (hasToolCall) return null;
      const text = extractText(content);
      if (!text) return null;

      const timestamp = parseTimestamp(obj as Record<string, unknown>, undefined, message);

      return {
        id: String(obj.id ?? ""),
        timestamp,
        role: "assistant",
        speaker: "assistant",
        content: text,
        channelKey: "",
      };
    }

    return null;
  }

  return null;
}

export async function scanJsonlFileReverse(
  filePath: string,
  options: ScanOptions,
): Promise<ParsedMessage[]> {
  const results: ParsedMessage[] = [];

  // Read all lines into memory, then scan from end (newest first)
  const lines: string[] = [];
  for await (const line of createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
  })) {
    lines.push(line);
  }

  // Detect compaction marker position (scan forward to find it)
  let compactionIndex = -1;
  if (options.isCurrentSession) {
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseJsonlLine(lines[i]);
      if (parsed && "type" in parsed && parsed.type === "compaction_marker") {
        compactionIndex = i;
        break;
      }
    }
  }

  // Scan from end (newest messages first)
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonlLine(lines[i]);

    if (parsed && "type" in parsed && parsed.type === "compaction_marker") continue;

    // Current session: skip compacted messages (before compaction marker)
    if (options.isCurrentSession && compactionIndex >= 0 && i < compactionIndex) {
      continue;
    }

    if (!parsed) continue;
    if ("type" in parsed) continue;

    if (options.roleMatcher && !options.roleMatcher(parsed.role)) continue;
    if (options.senderMatcher && !options.senderMatcher(parsed)) continue;
    if (options.contentMatcher && !options.contentMatcher(parsed.content)) continue;

    if (options.since || options.until) {
      if (options.since && parsed.timestamp < options.since) continue;
      if (options.until && parsed.timestamp > options.until) continue;
    }

    results.push(parsed);

    if (options.maxHits && results.length >= options.maxHits) break;
  }

  return results;
}

export async function scanJsonlFile(
  filePath: string,
  options: ScanOptions,
): Promise<ParsedMessage[]> {
  const results: ParsedMessage[] = [];
  let lineCount = 0;
  let compactionFound = false;

  for await (const line of createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
  })) {
    lineCount++;
    if (options.maxLines && lineCount > options.maxLines) break;

    const parsed = parseJsonlLine(line);

    if (parsed && "type" in parsed && parsed.type === "compaction_marker") {
      compactionFound = true;
      continue;
    }

    // 当前会话文件中，compaction marker 之后的消息是最近的，会进入 LLM 上下文，跳过
    // 如果没有 compaction marker，整个文件都是最近的，全部跳过
    if (options.isCurrentSession && compactionFound) {
      continue;
    }

    if (!parsed) continue;
    if ("type" in parsed) continue;

    if (options.roleMatcher && !options.roleMatcher(parsed.role)) continue;
    if (options.senderMatcher && !options.senderMatcher(parsed)) continue;
    if (options.contentMatcher && !options.contentMatcher(parsed.content)) continue;

    if (options.since || options.until) {
      if (options.since && parsed.timestamp < options.since) continue;
      if (options.until && parsed.timestamp > options.until) continue;
    }

    results.push(parsed);

    if (options.maxHits && results.length >= options.maxHits) break;
  }

  return results;
}
