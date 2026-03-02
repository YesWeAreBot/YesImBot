import type { FilePart, ImagePart, TextPart, UserContent } from "ai";

export interface TrimConfig {
  charBudget: number;
  keepLastRounds: number;
  softTrimHead: number;
  softTrimTail: number;
  initialContextCharBudget?: number;
}

export interface LoopMessage {
  role: "user" | "assistant";
  content: string | UserContent;
  _trimState?: "none" | "soft" | "hard";
}

function softTrim(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 20) return text;
  return text.slice(0, head) + "\n...(trimmed)...\n" + text.slice(-tail);
}

function hardClearToolResult(content: string): string {
  // XML format: <tool-results><tool-result name="...">...</tool-result></tool-results>
  const xmlMatch = content.match(/<tool-results>([\s\S]*?)<\/tool-results>/);
  if (xmlMatch) {
    const names: string[] = [];
    const nameRegex = /name="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(xmlMatch[1])) !== null) {
      names.push(m[1]);
    }
    if (names.length) return `[tool results cleared: ${names.join(", ")}]`;
    return "[tool results cleared]";
  }
  // Legacy JSON format fallback (for existing messages in flight)
  try {
    const match = content.match(/^Tool results:\n(.+)$/s);
    if (match) {
      const items = JSON.parse(match[1]) as Array<{ name?: string }>;
      const names = items.map((i) => i.name).filter(Boolean);
      if (names.length) return `[tool results cleared: ${names.join(", ")}]`;
    }
  } catch {}
  return "[tool results cleared]";
}

function totalChars(messages: LoopMessage[]): number {
  let sum = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      sum += m.content.length;
    } else {
      // UserContent array — sum text parts only
      for (const part of m.content) {
        if (part.type === "text") sum += part.text.length;
      }
    }
  }
  return sum;
}

export function trimMessages(messages: LoopMessage[], config: TrimConfig): void {
  if (totalChars(messages) <= config.charBudget) return;

  // Trim messages[0] independently if it exceeds its own budget
  if (
    messages.length > 1 &&
    config.initialContextCharBudget !== undefined &&
    typeof messages[0].content === "string" &&
    messages[0].content.length > config.initialContextCharBudget
  ) {
    const m0 = messages[0];
    const content = m0.content as string;
    const excess = content.length - config.initialContextCharBudget;
    const cutPoint = content.indexOf("\n", excess);
    if (cutPoint !== -1) {
      m0.content = "...(trimmed)\n" + content.slice(cutPoint + 1);
    } else {
      m0.content = "...(trimmed)\n" + content.slice(excess);
    }
    if (totalChars(messages) <= config.charBudget) return;
  }

  // Identify rounds: index 0 protected, rounds are (assistant, user) pairs from index 1
  // round 1 = [1,2], round 2 = [3,4], etc.
  const totalRounds = Math.floor((messages.length - 1) / 2);
  const protectedRounds = Math.min(config.keepLastRounds, totalRounds);
  const eligibleEnd = 1 + (totalRounds - protectedRounds) * 2;

  // Collect eligible indices: user messages first (tool results), then assistant
  const userIndices: number[] = [];
  const assistantIndices: number[] = [];
  for (let i = 1; i < eligibleEnd; i++) {
    if (messages[i].role === "user") userIndices.push(i);
    else assistantIndices.push(i);
  }
  const eligible = [...userIndices, ...assistantIndices];

  // First pass: softTrim
  for (const i of eligible) {
    const msg = messages[i];
    if (msg._trimState === undefined || msg._trimState === "none") {
      if (typeof msg.content === "string") {
        msg.content = softTrim(msg.content, config.softTrimHead, config.softTrimTail);
        msg._trimState = "soft";
        if (totalChars(messages) <= config.charBudget) return;
      }
    }
  }

  // Second pass: hardClear
  for (const i of eligible) {
    const msg = messages[i];
    if (msg._trimState !== "hard") {
      if (typeof msg.content === "string") {
        msg.content =
          msg.role === "user" ? hardClearToolResult(msg.content) : "[assistant response cleared]";
        msg._trimState = "hard";
        if (totalChars(messages) <= config.charBudget) return;
      }
    }
  }
}
