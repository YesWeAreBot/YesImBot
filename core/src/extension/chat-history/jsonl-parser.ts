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

export function parseJsonlLine(line: string): ParsedMessage | null {
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

    const ts = details.timestamp;
    const timestamp =
      typeof ts === "number" ? new Date(ts).toISOString() : String(ts ?? "");

    return {
      id: String(details.id ?? obj.id ?? ""),
      timestamp,
      role: "user",
      speaker,
      content: text,
      channelKey: "",
    };
  }

  if (type === "message") {
    const message = (obj.message ?? {}) as Record<string, unknown>;
    const role = message.role;

    if (role === "tool") return null;

    if (role === "assistant") {
      const content = message.content;
      if (!Array.isArray(content)) return null;
      const hasToolCall = content.some((p: { type: string }) => p.type === "tool-call");
      if (hasToolCall) return null;
      const text = extractText(content);
      if (!text) return null;

      return {
        id: String(obj.id ?? ""),
        timestamp: String(obj.timestamp ?? ""),
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

export async function scanJsonlFile(
  filePath: string,
  options: ScanOptions,
): Promise<ParsedMessage[]> {
  const results: ParsedMessage[] = [];
  let lineCount = 0;

  for await (const line of createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
  })) {
    lineCount++;
    if (options.maxLines && lineCount > options.maxLines) break;

    const parsed = parseJsonlLine(line);
    if (!parsed) continue;

    if (options.roleMatcher && !options.roleMatcher(parsed.role)) continue;
    if (options.senderMatcher && !options.senderMatcher(parsed.speaker)) continue;
    if (options.contentMatcher && !options.contentMatcher(parsed.content)) continue;

    if (options.since || options.until) {
      const ts = new Date(parsed.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (options.since && ts < options.since) continue;
      if (options.until && ts > options.until) continue;
    }

    results.push(parsed);

    if (options.maxHits && results.length >= options.maxHits) break;
  }

  return results;
}
