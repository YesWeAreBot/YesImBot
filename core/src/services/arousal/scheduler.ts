import type { ArousalConfig, SelectedChannel } from "./types";

/**
 * Channel summary data for global heartbeat evaluation.
 */
export interface ChannelSummary {
  channelKey: string;
  lastMessageTime: Date;
  lastContent: string;
  messageCount: number;
}

/**
 * Evaluate active channels using a small model and select interesting ones
 * for heartbeat. Fail-safe: returns empty array on any error.
 *
 * @param modelService - The model service to call for evaluation
 * @param config - Arousal configuration
 * @param activeChannels - List of channels with recent activity summaries
 * @returns Array of selected channels with platform, channelId, and reason
 */
export async function evaluateChannels(
  modelService: {
    call: (
      model: string,
      params: unknown,
      fallback?: string[],
    ) => Promise<{ text: string } | undefined>;
  },
  config: ArousalConfig,
  activeChannels: ChannelSummary[],
): Promise<SelectedChannel[]> {
  if (activeChannels.length === 0) {
    return [];
  }

  try {
    const channelDescriptions = activeChannels
      .map((ch) => {
        const timeSince = Date.now() - ch.lastMessageTime.getTime();
        const minutesAgo = Math.round(timeSince / 60000);
        return `- ${ch.channelKey}: last message ${minutesAgo}min ago, ${ch.messageCount} recent messages, last: "${ch.lastContent.slice(0, 100)}"`;
      })
      .join("\n");

    const prompt = `You are evaluating chat channels to decide where a bot should check in proactively.

Here are channels with recent activity:
${channelDescriptions}

Select channels where the bot should check in. Consider:
- Time since last bot message
- Conversation relevance and natural follow-up opportunities
- Whether a check-in would feel natural

Respond with ONLY a JSON array of objects with "channelKey" and "reason" fields.
Example: [{"channelKey": "discord:123", "reason": "Active discussion about topic X"}]
If no channels warrant a check-in, respond with an empty array: []`;

    const model = config.evaluationModel ?? "openai:gpt-4o-mini";
    const result = await modelService.call(model, {
      messages: [{ role: "user" as const, content: prompt }],
      maxOutputTokens: 512,
      temperature: 0.3,
    });

    if (!result?.text) {
      return [];
    }

    const parsed = parseModelResponse(result.text);
    const excludeSet = new Set(config.excludeChannels);

    return parsed
      .filter((item) => !excludeSet.has(item.channelKey))
      .map((item) => {
        const [platform, ...channelParts] = item.channelKey.split(":");
        const channelId = channelParts.join(":");
        return {
          platform,
          channelId,
          reason: item.reason ?? "Selected by evaluation",
        };
      });
  } catch {
    // Fail-safe: return empty array on any error
    return [];
  }
}

/**
 * Parse the model response text into an array of selected channels.
 * Handles both clean JSON and markdown-wrapped JSON responses.
 */
function parseModelResponse(text: string): Array<{ channelKey: string; reason?: string }> {
  try {
    // Try direct JSON parse first
    const trimmed = text.trim();

    // Handle markdown code blocks
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : trimmed;

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is { channelKey: string; reason?: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).channelKey === "string",
    );
  } catch {
    return [];
  }
}
