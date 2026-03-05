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

export function totalChars(messages: LoopMessage[]): number {
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

/**
 * Identify conversation round boundaries.
 *
 * Round semantics: A round consists of one or more user messages followed by
 * zero or more assistant messages, until the next user message or end of array.
 *
 * Examples:
 * - [user, assistant, user, assistant] → 2 rounds
 * - [user, user, assistant] → 1 round (consecutive user messages in same round)
 * - [user, assistant, assistant, user] → 2 rounds (multiple assistant responses)
 * - [user, user, user] → 1 round (all user messages)
 *
 * @param messages - Array of messages to analyze
 * @param startIdx - Index to start analyzing from (default 0)
 * @returns Array of round boundaries: [[startIdx, endIdx], ...]
 */
function identifyRoundBoundaries(messages: LoopMessage[], startIdx: number = 0): number[][] {
  if (startIdx >= messages.length) return [];

  const rounds: number[][] = [];
  let roundStart = startIdx;
  let inRound = false;

  for (let i = startIdx; i < messages.length; i++) {
    const current = messages[i];
    const isLastMessage = i === messages.length - 1;
    const next = !isLastMessage ? messages[i + 1] : null;

    // Start a round when we see a user message
    if (current.role === "user" && !inRound) {
      roundStart = i;
      inRound = true;
    }

    // End round when: (1) last message, OR (2) current is assistant and next is user
    if (inRound && (isLastMessage || (current.role === "assistant" && next?.role === "user"))) {
      rounds.push([roundStart, i]);
      inRound = false;
    }
  }

  return rounds;
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

  // Identify conversation rounds
  // Start from index 0 to include all conversation messages in round detection
  const rounds = identifyRoundBoundaries(messages, 0);
  if (rounds.length === 0) return;

  // Protect last N rounds
  const protectedRounds = Math.min(config.keepLastRounds, rounds.length);
  const eligibleRounds = rounds.slice(0, rounds.length - protectedRounds);

  // Collect eligible message indices from eligible rounds
  // Priority: user messages first (tool results), then assistant
  const userIndices: number[] = [];
  const assistantIndices: number[] = [];

  for (const [start, end] of eligibleRounds) {
    for (let i = start; i <= end; i++) {
      if (messages[i].role === "user") userIndices.push(i);
      else assistantIndices.push(i);
    }
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
