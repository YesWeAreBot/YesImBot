import { Context, Logger } from "koishi";

import { ChannelKey } from "../../runtime/contracts";
import type { ModelService } from "../model/service";
import { EventManager } from "./manager";
import { TimelineEntry, SummaryRecord, TimelineEventType, TimelineStage } from "./types";

export interface CompressorConfig {
  compressionThreshold: number; // Event count to trigger (default: 80)
  inactivityTriggerMs: number; // Inactivity period to trigger (default: 1800000 = 30min)
  retainRecentEntries: number; // Keep N most recent entries uncompressed (default: 10)
}

const DEFAULT_CONFIG: CompressorConfig = {
  compressionThreshold: 80,
  inactivityTriggerMs: 1800000,
  retainRecentEntries: 10,
};

export class SummaryCompressor {
  private logger: Logger;
  private compressionInProgress = new Map<string, Promise<void>>();
  private lastCompressionTime = new Map<string, number>();
  private lastCompressionSucceeded = new Map<string, boolean>();
  private config: CompressorConfig;

  constructor(
    private ctx: Context,
    private events: EventManager,
    private summaryModel?: string,
    config?: Partial<CompressorConfig>,
  ) {
    this.logger = ctx.logger("horizon.compressor");
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check hybrid trigger conditions and compress if needed.
   * Triggers on:
   *   a) Event count >= compressionThreshold
   *   b) Time since last compression >= inactivityTriggerMs AND event count > retainRecentEntries
   */
  async maybeCompress(channelKey: ChannelKey): Promise<void> {
    const key = `${channelKey.platform}:${channelKey.channelId}`;

    // Skip if compression already in progress for this channel
    if (this.compressionInProgress.has(key)) {
      this.logger.debug(`Compression already in progress for ${key}, skipping`);
      return;
    }

    // Query active timeline entries for this channel (exclude archived/deleted)
    const entries = await this.events.query({
      key: channelKey,
      types: [
        TimelineEventType.Message,
        TimelineEventType.AgentResponse,
        TimelineEventType.AgentAction,
        TimelineEventType.Heartbeat,
      ],
      stages: [TimelineStage.Active],
      orderBy: "asc",
    });

    const entryCount = entries.length;
    const now = Date.now();
    const lastTime = this.lastCompressionTime.get(key);

    // Initialize lastCompressionTime if not set
    if (lastTime === undefined) {
      this.lastCompressionTime.set(key, now);
      // Only trigger on event count for the very first check (no time baseline yet)
      if (entryCount < this.config.compressionThreshold) {
        return;
      }
    }

    // Check hybrid trigger conditions
    const countTrigger = entryCount >= this.config.compressionThreshold;
    const timeSinceLastCompression = now - (this.lastCompressionTime.get(key) ?? now);
    const inactivityTrigger =
      timeSinceLastCompression >= this.config.inactivityTriggerMs &&
      entryCount > this.config.retainRecentEntries;

    if (!countTrigger && !inactivityTrigger) {
      return;
    }

    this.logger.info(
      `Compression triggered for ${key}: count=${entryCount}, ` +
        `countTrigger=${countTrigger}, inactivityTrigger=${inactivityTrigger}`,
    );

    // Compress, retaining recent entries
    await this.compress(channelKey, entries, this.config.retainRecentEntries);

    // Update only on successful compression.
    if (this.lastCompressionSucceeded.get(key)) {
      this.lastCompressionTime.set(key, Date.now());
    }
  }

  async compress(
    channelKey: ChannelKey,
    entries: TimelineEntry[],
    retainCount?: number,
  ): Promise<void> {
    const key = `${channelKey.platform}:${channelKey.channelId}`;
    this.lastCompressionSucceeded.set(key, false);

    // Deduplication: if compression already in progress for this channel, skip
    if (this.compressionInProgress.has(key)) {
      this.logger.debug(`Compression already in progress for ${key}, skipping`);
      return;
    }

    // When retainCount is specified, split entries into compressible and retained
    let entriesToCompress = entries;
    if (retainCount !== undefined && retainCount > 0) {
      const splitIndex = Math.max(0, entries.length - retainCount);
      entriesToCompress = entries.slice(0, splitIndex);

      if (entriesToCompress.length === 0) {
        this.logger.debug(
          `All entries within retain window (${entries.length} <= ${retainCount}), skipping`,
        );
        return;
      }
    }

    // Create promise and store it
    const compressionPromise = this.doCompress(channelKey, entriesToCompress)
      .then((success) => {
        this.lastCompressionSucceeded.set(key, success);
      })
      .finally(() => {
        this.compressionInProgress.delete(key);
      });

    this.compressionInProgress.set(key, compressionPromise);
    return compressionPromise;
  }

  private async doCompress(channelKey: ChannelKey, entries: TimelineEntry[]): Promise<boolean> {
    try {
      const prevSummary = await this.getLatestSummary(channelKey);
      const prompt = this.buildPrompt(entries, prevSummary);

      const modelService = this.ctx["yesimbot.model"] as ModelService;
      const model = this.summaryModel || "openai:gpt-4o-mini";
      const result = await modelService.call(model, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });

      if (!result) {
        this.logger.warn("Model returned no result");
        return false;
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

      // Emit compression event for downstream consumers (e.g., MemoryAgentService)
      const afterEntries = await this.events.query({
        key: channelKey,
        types: [
          TimelineEventType.Message,
          TimelineEventType.AgentResponse,
          TimelineEventType.AgentAction,
          TimelineEventType.Heartbeat,
        ],
        orderBy: "asc",
      });
      this.ctx.emit(
        "athena:timeline.compressed",
        { platform: channelKey.platform, channelId: channelKey.channelId },
        entries.length,
        afterEntries.length,
      );

      this.logger.info("Summary generated successfully");
      return true;
    } catch (err) {
      this.logger.warn("Summary generation failed:", err);
      return false;
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

    // Archive all entries covered by the summary, excluding Summary entries themselves
    const query = {
      platform: key.platform,
      channelId: key.channelId,
      stage: TimelineStage.Active,
      timestamp: { $lte: coveredUntil },
      type: { $ne: TimelineEventType.Summary },
    };

    await this.ctx.database.set("yesimbot.timeline", query, {
      stage: TimelineStage.Archived,
    });

    this.logger.info(`Archived entries until ${coveredUntil.toISOString()}`);
  }
}
