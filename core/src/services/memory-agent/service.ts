import { Context, Service } from "koishi";

import type { ModelService } from "../model/service";
import type { ChannelKey } from "../shared/types";
import type { HorizonService } from "../horizon/service";
import { TimelineEventType, TimelineStage } from "../horizon/types";
import type { MemoryAgentConfig, MemoryRecord } from "./types";
import { MemoryType, MemoryScope } from "./types";
import { runMemoryExtraction } from "./agent";

declare module "koishi" {
  interface Context {
    "yesimbot.memory-agent": MemoryAgentService;
  }
  interface Tables {
    "yesimbot.memory": MemoryRecord;
  }
}

export interface MemoryAgentServiceConfig {
  memoryAgent: MemoryAgentConfig;
}

const DEFAULT_CONFIG: MemoryAgentConfig = {
  compressionThreshold: 80,
  compressionIntervalMs: 3_600_000,
  inactivityTriggerMs: 1_800_000,
  coreMemoryBudget: 2000,
  maxAgentSteps: 15,
  retainRecentEntries: 10,
};

export class MemoryAgentService extends Service<MemoryAgentServiceConfig> {
  static inject = ["database", "yesimbot.model", "yesimbot.horizon"];

  private extractionInProgress = new Map<string, Promise<void>>();
  private agentConfig: MemoryAgentConfig;

  constructor(ctx: Context, config: MemoryAgentServiceConfig) {
    super(ctx, "yesimbot.memory-agent", true);
    this.config = config;
    this.logger = ctx.logger("memory-agent");
    this.agentConfig = { ...DEFAULT_CONFIG, ...config.memoryAgent };
  }

  protected async start(): Promise<void> {
    // Declare database model
    this.ctx.model.extend("yesimbot.memory", {
      id: "string(64)",
      type: "string(32)",
      scope: "string(16)",
      scopeId: "string(255)",
      platform: "string(64)",
      content: "text",
      importance: "unsigned",
      isCore: { type: "boolean", initial: false },
      createdAt: "timestamp",
      updatedAt: "timestamp",
    }, { primary: "id", autoInc: false });

    // Set up scheduled timer for periodic checks
    this.ctx.setInterval(
      () => this.scheduledCheck(),
      this.agentConfig.compressionIntervalMs,
    );

    // Listen for compression events to trigger memory extraction
    this.ctx.on(
      "athena:timeline.compressed",
      (channelKey) => this.onTimelineCompressed(channelKey),
    );

    this.logger.info("MemoryAgentService started");
  }

  /**
   * Periodic scheduled check: iterate active channels and run memory extraction.
   */
  private async scheduledCheck(): Promise<void> {
    try {
      const channels = await this.getActiveChannels();
      for (const channel of channels) {
        await this.maybeRunAgent(channel);
      }
    } catch (err) {
      this.logger.warn("Scheduled memory check failed:", err);
    }
  }

  /**
   * Triggered after summary compression completes for a channel.
   */
  private async onTimelineCompressed(
    channelKey: { platform: string; channelId: string },
  ): Promise<void> {
    this.logger.info(
      `Timeline compressed for ${channelKey.platform}:${channelKey.channelId}, triggering memory extraction`,
    );
    await this.maybeRunAgent({
      platform: channelKey.platform,
      channelId: channelKey.channelId,
    });
  }

  /**
   * Run memory extraction for a channel if not already in progress.
   * Uses a Map to track in-progress extractions (same pattern as SummaryCompressor).
   */
  async maybeRunAgent(channelKey: ChannelKey): Promise<void> {
    const key = `${channelKey.platform}:${channelKey.channelId}`;

    if (this.extractionInProgress.has(key)) {
      this.logger.debug(`Memory extraction already in progress for ${key}, skipping`);
      return;
    }

    const extractionPromise = runMemoryExtraction(
      this.ctx,
      channelKey,
      channelKey.platform,
      this.agentConfig,
    ).finally(() => {
      this.extractionInProgress.delete(key);
    });

    this.extractionInProgress.set(key, extractionPromise);

    try {
      await extractionPromise;
    } catch (err) {
      this.logger.warn(`Memory extraction failed for ${key}:`, err);
    }
  }

  /**
   * Query distinct platform+channelId combinations with recent timeline activity.
   */
  private async getActiveChannels(): Promise<ChannelKey[]> {
    const cutoff = new Date(Date.now() - this.agentConfig.inactivityTriggerMs * 2);
    const entries = await this.ctx.database
      .select("yesimbot.timeline")
      .where({
        stage: TimelineStage.Active,
        timestamp: { $gte: cutoff },
      })
      .orderBy("timestamp", "desc")
      .limit(200)
      .execute();

    // Deduplicate by platform:channelId
    const seen = new Set<string>();
    const channels: ChannelKey[] = [];
    for (const entry of entries) {
      const key = `${entry.platform}:${entry.channelId}`;
      if (!seen.has(key)) {
        seen.add(key);
        channels.push({ platform: entry.platform, channelId: entry.channelId });
      }
    }

    return channels;
  }
}
