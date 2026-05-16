/**
 * Context compaction for long sessions.
 *
 * Pure functions for compaction logic. The session manager handles I/O,
 * and after compaction the session is reloaded.
 */
import { LanguageModel, LanguageModelUsage, streamText } from "ai";

import { AgentMessage, AssistantMessage } from "../../agent/index.js";
import { convertToLlm, createCompactionSummaryMessage, createCustomMessage } from "../messages.js";
import { buildSessionContext, CompactionEntry, SessionEntry } from "../session-manager.js";
import { serializeConversation, SUMMARIZATION_SYSTEM_PROMPT } from "./utils.js";

// ============================================================================
// Message Extraction
// ============================================================================

/**
 * Extract AgentMessage from an entry if it produces one.
 * Returns undefined for entries that don't contribute to LLM context.
 */
function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "custom_message") {
    return createCustomMessage(
      entry.customType,
      entry.content,
      entry.display,
      entry.details,
      entry.timestamp,
    );
  }
  if (entry.type === "compaction") {
    return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
  }
  return undefined;
}

function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return undefined;
  }
  return getMessageFromEntry(entry);
}

/** Result from compact() - SessionManager adds uuid/parentUuid when saving */
export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
  details?: T;
}

// ============================================================================
// Types
// ============================================================================

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

// ============================================================================
// CompactionPrompts (configurable prompts)
// ============================================================================

/**
 * Configurable prompts for compaction summarization.
 * All fields are optional; missing fields use chat-scenario defaults.
 */
export interface CompactionPrompts {
  /** System prompt for summarization LLM call */
  systemPrompt?: string;
  /** Prompt for initial compaction (no previous summary) */
  summarizationPrompt?: string;
  /** Prompt for updating existing summary with new messages */
  updateSummarizationPrompt?: string;
  /** Prompt for turn prefix summarization (split turn) */
  turnPrefixPrompt?: string;
}

export const DEFAULT_COMPACTION_PROMPTS: Required<CompactionPrompts> = {
  systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,

  summarizationPrompt: `The messages above are a conversation to summarize. Create a structured context summary that preserves the most useful information for continuing the conversation.

Use this EXACT format:

## User Profile & Preferences
- [User identity, language preference, communication style, long-term preferences]
- [Or "(none)" if not mentioned]

## Current Goals & Open Items
- [What the user is trying to accomplish]
- [Unfinished tasks, pending questions, items awaiting response]

## Key Facts & Context
- [Important facts, data, entities, timelines relevant to future replies]
- [Or "(none)" if not applicable]

## Confirmed Conclusions & Agreements
- [Decisions made, conclusions reached, explicit agreements]
- [Or "(none)" if none were reached]

## Notes for Next Reply
- [Things the user explicitly asked to remember]
- [Topics marked for later continuation]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact names, dates, and references. Remove greetings, small talk, resolved items with no future value, and repetitive content.`,

  updateSummarizationPrompt: `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new facts, preferences, goals, and conclusions from the new messages
- UPDATE open items: move completed items out, add new ones
- REMOVE outdated information that was explicitly corrected by the user
- If conflicting information exists, keep the latest user-confirmed version and note the update

Use this EXACT format:

## User Profile & Preferences
- [Preserve existing, add new discoveries]

## Current Goals & Open Items
- [Update based on progress, add new goals]

## Key Facts & Context
- [Preserve existing, add new facts, remove outdated]

## Confirmed Conclusions & Agreements
- [Preserve existing, add new conclusions]

## Notes for Next Reply
- [Update based on current state]

Keep each section concise. Preserve exact names, dates, and references.`,

  turnPrefixPrompt: `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent messages) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Key Context
- [Important information from the prefix needed to understand the suffix]

## Early Progress
- [Key points discussed or decided in the prefix]

Be concise. Focus on what's needed to understand the kept suffix.`,
};

// ============================================================================
// Token calculation
// ============================================================================

/**
 * Calculate total context tokens from usage.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage: Partial<LanguageModelUsage>): number {
  if (usage.totalTokens !== undefined) {
    return usage.totalTokens;
  }
  let total = 0;
  if (usage.inputTokens !== undefined) {
    total += usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    total += usage.outputTokens;
  }
  return total;
}

/**
 * Get usage from an assistant message if available.
 * Skips aborted and error messages as they don't have valid usage data.
 */
function getAssistantUsage(msg: AgentMessage): Partial<LanguageModelUsage> | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (
      assistantMsg.finishReason !== "abort" &&
      assistantMsg.finishReason !== "error" &&
      assistantMsg.usage
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

/**
 * Find the last non-aborted assistant message usage from session entries.
 */
export function getLastAssistantUsage(
  entries: SessionEntry[],
): Partial<LanguageModelUsage> | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message") {
      const usage = getAssistantUsage(entry.message);
      if (usage) return usage;
    }
  }
  return undefined;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Partial<LanguageModelUsage>; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/**
 * Estimate context tokens from messages, using the last assistant usage when available.
 * If there are messages after the last usage, estimate their tokens with estimateTokens.
 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/**
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Cut point detection
// ============================================================================

/**
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user": {
      const content = (message as { content: string | Array<{ type: string; text?: string }> })
        .content;
      if (typeof content === "string") {
        chars = content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
        }
      }
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      const legacyContent = assistant.content as AssistantMessage["content"] | string;
      if (typeof legacyContent === "string") {
        return Math.ceil(legacyContent.length / 4);
      }
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "reasoning") {
          chars += block.text.length;
        } else if (block.type === "tool-call") {
          chars += block.toolName.length + JSON.stringify(block.input).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "tool": {
      chars = JSON.stringify(message.content).length;
      return Math.ceil(chars / 4);
    }
    case "custom": {
      if (typeof message.content === "string") {
        chars = message.content.length;
      } else {
        for (const block of message.content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
          if (block.type === "image") {
            chars += 4800; // Estimate images as 4000 chars, or 1200 tokens
          }
        }
      }
      return Math.ceil(chars / 4);
    }
    case "compactionSummary": {
      chars = message.summary.length;
      return Math.ceil(chars / 4);
    }
  }

  return 0;
}

/**
 * Find valid cut points: indices of user, assistant, custom, or bashExecution messages.
 * Never cut at tool results (they must follow their tool call).
 * When we cut at an assistant message with tool calls, its tool results follow it
 * and will be kept.
 * BashExecutionMessage is treated like a user message (user-initiated context).
 */
function findValidCutPoints(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    switch (entry.type) {
      case "message": {
        const role = entry.message.role;
        switch (role) {
          case "custom":
          case "compactionSummary":
          case "user":
          case "assistant":
            cutPoints.push(i);
            break;
          case "tool":
            break;
        }
        break;
      }
      case "thinking_level_change":
      case "model_change":
      case "compaction":
      case "custom":
      case "custom_message":
      case "session_info":
        break;
    }

    // branch_summary and custom_message are user-role messages, valid cut points
    if (entry.type === "custom_message") {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

/**
 * Find the user message (or bashExecution) that starts the turn containing the given entry index.
 * Returns -1 if no turn start found before the index.
 * BashExecutionMessage is treated like a user message for turn boundaries.
 */
export function findTurnStartIndex(
  entries: SessionEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    // branch_summary and custom_message are user-role messages, can start a turn
    if (entry.type === "custom_message") {
      return i;
    }
    if (entry.type === "message") {
      const role = entry.message.role;
      if (role === "user") {
        return i;
      }
    }
  }
  return -1;
}

export interface CutPointResult {
  /** Index of first entry to keep */
  firstKeptEntryIndex: number;
  /** Index of user message that starts the turn being split, or -1 if not splitting */
  turnStartIndex: number;
  /** Whether this cut splits a turn (cut point is not a user message) */
  isSplitTurn: boolean;
}

/**
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
 *
 * Algorithm: Walk backwards from newest, accumulating estimated message sizes.
 * Stop when we've accumulated >= keepRecentTokens. Cut at that point.
 *
 * Can cut at user OR assistant messages (never tool results). When cutting at an
 * assistant message with tool calls, its tool results come after and will be kept.
 *
 * Returns CutPointResult with:
 * - firstKeptEntryIndex: the entry index to start keeping from
 * - turnStartIndex: if cutting mid-turn, the user message that started that turn
 * - isSplitTurn: whether we're cutting in the middle of a turn
 *
 * Only considers entries between `startIndex` and `endIndex` (exclusive).
 */
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }

  // Walk backwards from newest, accumulating estimated message sizes
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0]; // Default: keep from first message (not header)

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;

    // Estimate this message's size
    const messageTokens = estimateTokens(entry.message);
    accumulatedTokens += messageTokens;

    // Check if we've exceeded the budget
    if (accumulatedTokens >= keepRecentTokens) {
      // Find the closest valid cut point at or after this entry
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }

  // Scan backwards from cutIndex to include any non-message entries (bash, settings, etc.)
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    // Stop at session header or compaction boundaries
    if (prevEntry.type === "compaction") {
      break;
    }
    if (prevEntry.type === "message") {
      // Stop if we hit any message
      break;
    }
    // Include this non-message entry (bash, settings change, etc.)
    cutIndex--;
  }

  // Determine if this is a split turn
  const cutEntry = entries[cutIndex];
  const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

// ============================================================================
// Summarization
// ============================================================================

/**
 * Generate a summary of the conversation using the LLM.
 * If previousSummary is provided, uses the update prompt to merge.
 */
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: LanguageModel,
  reserveTokens: number,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  prompts?: CompactionPrompts,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * reserveTokens);

  // Use update prompt if we have a previous summary, otherwise initial prompt
  const effectivePrompts = { ...DEFAULT_COMPACTION_PROMPTS, ...prompts };
  let basePrompt = previousSummary
    ? effectivePrompts.updateSummarizationPrompt
    : effectivePrompts.summarizationPrompt;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }

  // Serialize conversation to text so model doesn't try to continue it
  // Convert to LLM messages first (handles custom types like bashExecution, custom, etc.)
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);

  // Build the prompt with conversation wrapped in tags
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const response = await streamText({
    model,
    system: effectivePrompts.systemPrompt,
    messages: summarizationMessages,
    maxOutputTokens: maxTokens,
    abortSignal: signal,
    onError: () => {},
  });
  const reader = response.fullStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (value.type === "error") {
        throw new Error(
          `Summarization failed: ${value.error instanceof Error ? value.error.message : String(value.error)}`,
        );
      }
    }
  }

  const content = await response.content;
  const textContent = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return textContent;
}

// ============================================================================
// Compaction Preparation (for extensions)
// ============================================================================

export interface CompactionPreparation {
  /** UUID of first entry to keep */
  firstKeptEntryId: string;
  /** Messages that will be summarized and discarded */
  messagesToSummarize: AgentMessage[];
  /** Messages that will be turned into turn prefix summary (if splitting) */
  turnPrefixMessages: AgentMessage[];
  /** Whether this is a split turn (cut point in middle of turn) */
  isSplitTurn: boolean;
  tokensBefore: number;
  /** Summary from previous compaction, for iterative update */
  previousSummary?: string;
  /** Compaction settions from settings.jsonl	*/
  settings: CompactionSettings;
}

export function prepareCompaction(
  pathEntries: SessionEntry[],
  settings: CompactionSettings,
): CompactionPreparation | undefined {
  if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === "compaction") {
    return undefined;
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    const firstKeptEntryIndex = pathEntries.findIndex(
      (entry) => entry.id === prevCompaction.firstKeptEntryId,
    );
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens;

  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);

  // Get UUID of first kept entry
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return undefined; // Session needs migration
  }
  const firstKeptEntryId = firstKeptEntry.id;

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

  // Messages to summarize (will be discarded after summary)
  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) messagesToSummarize.push(msg);
  }

  // Messages for turn prefix summary (if splitting a turn)
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }

  return {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    settings,
  };
}

// ============================================================================
// Main compaction function
// ============================================================================

/**
 * Generate summaries for compaction using prepared data.
 * Returns CompactionResult - SessionManager adds uuid/parentUuid when saving.
 *
 * @param preparation - Pre-calculated preparation from prepareCompaction()
 * @param customInstructions - Optional custom focus for the summary
 * @param prompts - Optional configurable prompts for summarization
 */
export async function compact(
  preparation: CompactionPreparation,
  model: LanguageModel,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  prompts?: CompactionPrompts,
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,

    settings,
  } = preparation;

  // Generate summaries (can be parallel if both needed) and merge into one
  let summary: string;

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    // Generate both summaries in parallel
    const [historyResult, turnPrefixResult] = await Promise.all([
      messagesToSummarize.length > 0
        ? generateSummary(
            messagesToSummarize,
            model,
            settings.reserveTokens,

            headers,
            signal,
            customInstructions,
            previousSummary,
            prompts,
          )
        : Promise.resolve("No prior history."),
      generateTurnPrefixSummary(
        turnPrefixMessages,
        model,
        settings.reserveTokens,

        headers,
        signal,
        prompts,
      ),
    ]);
    // Merge into single summary
    summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
  } else {
    // Just generate history summary
    summary = await generateSummary(
      messagesToSummarize,
      model,
      settings.reserveTokens,

      headers,
      signal,
      customInstructions,
      previousSummary,
      prompts,
    );
  }

  if (!firstKeptEntryId) {
    throw new Error("First kept entry has no UUID - session may need migration");
  }

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
  };
}

/**
 * Generate a summary for a turn prefix (when splitting a turn).
 */
async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: LanguageModel,
  reserveTokens: number,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  prompts?: CompactionPrompts,
): Promise<string> {
  const effectivePrompts = { ...DEFAULT_COMPACTION_PROMPTS, ...prompts };
  const maxTokens = Math.floor(0.5 * reserveTokens); // Smaller budget for turn prefix
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${effectivePrompts.turnPrefixPrompt}`;
  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  //   const response = await completeSimple(
  //     model,
  //     { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
  //     model.reasoning && thinkingLevel && thinkingLevel !== "off"
  //       ? { maxTokens, signal, apiKey, headers, reasoning: thinkingLevel }
  //       : { maxTokens, signal, apiKey, headers },
  //   );

  const response = await streamText({
    model,
    system: effectivePrompts.systemPrompt,
    messages: summarizationMessages,
    maxOutputTokens: maxTokens,
    abortSignal: signal,
    onError: () => {},
  });

  const reader = response.fullStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (value.type === "error") {
        throw new Error(
          `Turn prefix summarization failed: ${value.error instanceof Error ? value.error.message : String(value.error)}`,
        );
      }
    }
  }

  const content = await response.content;

  const textContent = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return textContent;
}
