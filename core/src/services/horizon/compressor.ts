import { Context, Logger } from "koishi";

import type { ModelService } from "../model/service";
import { ChannelKey } from "../shared/types";
import { EventManager } from "./manager";
import { TimelineEntry, SummaryRecord, TimelineEventType } from "./types";

export class SummaryCompressor {
  private logger: Logger;

  constructor(
    private ctx: Context,
    private events: EventManager,
  ) {
    this.logger = ctx.logger("horizon.compressor");
  }

  async compress(channelKey: ChannelKey, entries: TimelineEntry[]): Promise<void> {
    try {
      const prevSummary = await this.getLatestSummary(channelKey);
      const prompt = this.buildPrompt(entries, prevSummary);

      const modelService = this.ctx["yesimbot.model"] as ModelService;
      const result = await modelService.call("openai:gpt-4o-mini", {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });

      if (!result) {
        this.logger.warn("Model returned no result");
        return;
      }

      const coveredUntil = entries[entries.length - 1].timestamp;
      await this.events.recordSummary({
        platform: channelKey.platform,
        channelId: channelKey.channelId,
        timestamp: new Date(),
        data: {
          content: result.text,
          coveredUntil,
          previousSummaryId: prevSummary?.id,
        },
      });

      await this.archiveEntries(channelKey, coveredUntil);
      this.logger.info("Summary generated successfully");
    } catch (err) {
      this.logger.warn("Summary generation failed:", err);
    }
  }

  private async getLatestSummary(key: ChannelKey): Promise<SummaryRecord | undefined> {
    const entries = await this.events.query({
      key,
      limit: 10,
      orderBy: "desc",
    });
    return entries.find((e) => e.type === TimelineEventType.Summary) as SummaryRecord;
  }

  private buildPrompt(entries: TimelineEntry[], prevSummary?: SummaryRecord): string {
    let prompt = "Summarize the following conversation in 500-1000 characters. ";
    prompt += "Use third-person narrative. Include key topics and decisions.\n\n";

    if (prevSummary) {
      prompt += `Previous summary: ${prevSummary.data.content}\n\n`;
    }

    prompt += "Recent messages:\n";
    for (const entry of entries) {
      prompt += `- ${entry.type}: ${JSON.stringify(entry.data).slice(0, 200)}\n`;
    }

    return prompt;
  }

  private async archiveEntries(key: ChannelKey, coveredUntil: Date): Promise<void> {
    this.logger.debug("Archiving entries until", coveredUntil);
  }
}
