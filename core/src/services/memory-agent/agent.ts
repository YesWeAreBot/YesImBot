import { generateText, stepCountIs } from "ai";
import type { Context } from "koishi";

import { ChannelKey } from "../../runtime";
import type { HorizonService } from "../horizon/service";
import { TimelineEventType, type SummaryRecord, type TimelineEntry } from "../horizon/types";
import type { ModelService } from "../model/service";
import { createMemoryTools } from "./tools";
import { type MemoryAgentConfig } from "./types";

const MEMORY_AGENT_SYSTEM_PROMPT = `You are a memory management agent. Your job is to analyze conversation history and maintain structured memories about users, events, channels, and your own experiences.

## Memory Types
- **profile**: User traits, preferences, personality, relationship closeness, recurring behaviors
- **event**: Important channel events, milestones, notable incidents, decisions made
- **channel**: Social rules, active hours, atmosphere, recurring topics, group dynamics
- **experience**: Your own experiences — promises you made, help you gave, stances you took, things you learned

## Memory Scopes
- **user**: Cross-channel user profiles (visible everywhere that user appears)
- **channel**: Channel-level traits and events (visible only in this channel)
- **private**: Private chat information (visible only in private chat, strict isolation)

## Instructions
1. First, use queryMemories to review what memories already exist
2. Analyze the conversation for new information worth remembering
3. Create new memories for important information not yet recorded
4. Update existing memories if information has changed or can be refined
5. Delete memories that are outdated or no longer relevant
6. Merge similar or overlapping memories to reduce redundancy
7. Mark the most critical persistent facts as core memories (use sparingly)

## Core Memory Budget
Core memories are always included in the main agent's context. Keep total core memory characters under {{budget}} chars. Only mark truly essential, persistent facts as core.

## Guidelines
- Be selective — not everything needs to be remembered
- Prefer updating existing memories over creating duplicates
- Merge when possible to keep memory count manageable
- Higher importance (80-100) for personality traits, relationship facts, promises
- Medium importance (40-79) for preferences, recurring topics, recent events
- Lower importance (0-39) for minor observations, temporary states
- Delete obsolete information proactively`;

/**
 * Run memory extraction for a channel using ai-sdk agent loop.
 * Uses generateText with tools and maxSteps for autonomous memory management.
 */
export async function runMemoryExtraction(
  ctx: Context,
  channelKey: ChannelKey,
  platform: string,
  config: MemoryAgentConfig,
): Promise<void> {
  const logger = ctx.logger("memory-agent");

  try {
    // 1. Query recent timeline entries for context
    const horizon = ctx["yesimbot.horizon"] as HorizonService;
    const recentEntries = await horizon.events.query({
      key: channelKey,
      types: [
        TimelineEventType.Message,
        TimelineEventType.AgentResponse,
        TimelineEventType.AgentAction,
      ],
      limit: 50,
      orderBy: "desc",
    });

    if (recentEntries.length === 0) {
      logger.debug(
        `No recent entries for ${platform}:${channelKey.channelId}, skipping extraction`,
      );
      return;
    }

    // 2. Get latest summary for additional context
    const summaryEntries = await horizon.events.query({
      key: channelKey,
      types: [TimelineEventType.Summary],
      limit: 1,
      orderBy: "desc",
    });
    const latestSummary = summaryEntries[0] as SummaryRecord | undefined;

    // 3. Query existing memories for this channel
    const existingMemories = await ctx.database
      .select("yesimbot.memory")
      .where({ platform })
      .orderBy("importance", "desc")
      .limit(30)
      .execute();

    // 4. Build system prompt
    const systemPrompt = MEMORY_AGENT_SYSTEM_PROMPT.replace(
      "{{budget}}",
      String(config.coreMemoryBudget),
    );

    // 5. Build user prompt with context
    const userPrompt = buildUserPrompt(
      recentEntries.reverse(), // chronological order
      existingMemories,
      latestSummary,
      channelKey,
    );

    // 6. Resolve language model via ModelService
    const modelService = ctx["yesimbot.model"] as ModelService;
    const { model: languageModel } = modelService.getModel(
      config.summaryModel || "openai:gpt-4o-mini",
    );

    // 7. Create memory tools
    const tools = createMemoryTools(ctx, channelKey, platform, config);

    // 8. Run ai-sdk agent loop
    const result = await generateText({
      model: languageModel,
      system: systemPrompt,
      prompt: userPrompt,
      tools,
      stopWhen: stepCountIs(config.maxAgentSteps),
      temperature: 0.3,
    });

    // 9. Log results
    const toolCallCount = result.steps.reduce((count, step) => count + step.toolCalls.length, 0);

    logger.info(
      `Memory extraction complete for ${platform}:${channelKey.channelId}: ` +
        `steps=${result.steps.length}, toolCalls=${toolCallCount}`,
    );
  } catch (err) {
    logger.warn(`Memory extraction error for ${platform}:${channelKey.channelId}:`, err);
  }
}

/**
 * Build the user prompt containing conversation context and existing memories.
 */
function buildUserPrompt(
  entries: TimelineEntry[],
  existingMemories: Array<{
    id: string;
    type: string;
    scope: string;
    scopeId: string;
    content: string;
    importance: number;
    isCore: boolean;
  }>,
  latestSummary: SummaryRecord | undefined,
  channelKey: ChannelKey,
): string {
  const parts: string[] = [];

  parts.push(`## Channel: ${channelKey.platform}:${channelKey.channelId}\n`);

  // Add latest summary if available
  if (latestSummary) {
    parts.push("## Previous Summary");
    parts.push(latestSummary.data.content);
    parts.push("");
  }

  // Add recent conversation
  parts.push("## Recent Conversation");
  for (const entry of entries) {
    const ts =
      entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp);
    const data = entry.data;

    if (entry.type === TimelineEventType.Message) {
      const msg = data as { senderId: string; senderName: string; content: string };
      parts.push(`[${ts}] ${msg.senderName || msg.senderId}: ${msg.content}`);
    } else if (entry.type === TimelineEventType.AgentResponse) {
      const resp = data as { rawText: string };
      parts.push(`[${ts}] [Bot]: ${resp.rawText}`);
    } else if (entry.type === TimelineEventType.AgentAction) {
      const action = data as { actions: Array<{ name: string }> };
      const names = action.actions.map((a) => a.name).join(", ");
      parts.push(`[${ts}] [Bot Action]: ${names}`);
    }
  }
  parts.push("");

  // Add existing memories
  if (existingMemories.length > 0) {
    parts.push("## Existing Memories");
    for (const mem of existingMemories) {
      const coreTag = mem.isCore ? " [CORE]" : "";
      parts.push(
        `- [${mem.id}] (${mem.type}/${mem.scope}, importance=${mem.importance}${coreTag}): ${mem.content}`,
      );
    }
    parts.push("");
  } else {
    parts.push("## Existing Memories");
    parts.push("No existing memories for this context.");
    parts.push("");
  }

  parts.push(
    "Analyze the conversation above. Use the memory tools to create, update, delete, or merge memories as appropriate.",
  );

  return parts.join("\n");
}
