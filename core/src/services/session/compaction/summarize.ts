import type { LanguageModel } from "ai";
import { generateText } from "ai";

import type { AgentMessage } from "../session-manager";
import { serializeConversation } from "./serialize";

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant for a group chat with an AI participant. Do NOT continue the conversation. ONLY output the structured summary.`;

export const CHAT_SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context summary for a group chat AI participant.

Use this EXACT format:

## Participants
[Who was involved in this conversation segment]

## Topic Threads
- [Active discussion topics and their status]

## Unresolved Discussions
- [Questions or topics that were not concluded]

## AI Task State
- [Tasks the AI was asked to do and their completion status]

## Key Decisions
- [Decisions made during the conversation]

## Critical Context
- [Information needed to continue coherently]

Keep each section concise while preserving names, participants, and key facts.`;

export const CHAT_UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the structured summary with new information while preserving relevant existing context.

Use this EXACT format:

## Participants
[Who was involved in this conversation segment]

## Topic Threads
- [Active discussion topics and their status]

## Unresolved Discussions
- [Questions or topics that were not concluded]

## AI Task State
- [Tasks the AI was asked to do and their completion status]

## Key Decisions
- [Decisions made during the conversation]

## Critical Context
- [Information needed to continue coherently]

Keep each section concise while preserving names, participants, and key facts.`;

export const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a split conversation turn that was too large to keep fully.

Summarize only what is needed so the kept suffix remains understandable.

Use this EXACT format:

## Turn Request
[What the user or channel asked in this turn]

## Early Turn Progress
- [Important actions/outputs completed in the prefix]

## Context for Kept Suffix
- [What must be remembered to interpret the retained recent messages]

Be concise.`;

export async function generateSummary(
  messages: AgentMessage[],
  model: LanguageModel,
  reserveTokens: number,
  signal?: AbortSignal,
  previousSummary?: string,
): Promise<string> {
  const maxOutputTokens = Math.floor(0.8 * reserveTokens);
  const conversationText = serializeConversation(messages);
  const prompt = previousSummary ? CHAT_UPDATE_SUMMARIZATION_PROMPT : CHAT_SUMMARIZATION_PROMPT;

  let userContent = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    userContent += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  userContent += prompt;

  const result = await generateText({
    model,
    system: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    maxOutputTokens,
    abortSignal: signal,
  });

  return result.text;
}

export async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: LanguageModel,
  reserveTokens: number,
  signal?: AbortSignal,
): Promise<string> {
  const maxOutputTokens = Math.floor(0.5 * reserveTokens);
  const conversationText = serializeConversation(messages);
  const userContent = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;

  const result = await generateText({
    model,
    system: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    maxOutputTokens,
    abortSignal: signal,
  });

  return result.text;
}
