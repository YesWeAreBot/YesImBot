import { Context, Random, Service } from "koishi";

import { TokenBucket } from "../agent/willingness";
import type { TimelineEntry } from "../horizon/types";
import { TimelineEventType, TimelinePriority, TimelineStage } from "../horizon/types";
import { evaluateChannels, type ChannelSummary } from "./scheduler";
import type { ArousalConfig, DailyMessageCount } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.arousal": ArousalService;
  }
  interface Events {
    "athena:heartbeat": (data: {
      platform: string;
      channelId: string;
      triggeredBy: string;
    }) => void;
  }
}

const MS_PER_DAY = 86400000;

export class ArousalService extends Service<ArousalConfig> {
  static inject = ["yesimbot.model", "yesimbot.horizon"];

  private globalTimer?: () => void;
  private rateLimiter!: TokenBucket;
  private dailyMessageCounts = new Map<string, DailyMessageCount>();

  constructor(ctx: Context, config: ArousalConfig) {
    super(ctx, "yesimbot.arousal", false);
    this.config = config;
  }

  start(): void {
    if (!this.config.enabled) {
      this.logger.info("ArousalService disabled, skipping timer setup");
      return;
    }

    // Initialize rate limiter: capacity = daily limit, refill over 24h
    this.rateLimiter = new TokenBucket(
      this.config.dailyMessageLimit,
      this.config.dailyMessageLimit / 86400,
    );

    // Set up global heartbeat timer
    this.globalTimer = this.ctx.setInterval(
      () => this.globalHeartbeat(),
      this.config.heartbeatIntervalMs,
    );

    this.logger.info(
      `ArousalService started: interval=${this.config.heartbeatIntervalMs}ms, dailyLimit=${this.config.dailyMessageLimit}`,
    );
  }

  stop(): void {
    if (this.globalTimer) {
      this.globalTimer();
      this.globalTimer = undefined;
    }
    this.dailyMessageCounts.clear();
    this.logger.info("ArousalService stopped");
  }

  /**
   * Execute a global heartbeat cycle: evaluate all active channels,
   * select interesting ones, and emit heartbeat events.
   */
  async globalHeartbeat(): Promise<void> {
    try {
      const horizon = this.ctx["yesimbot.horizon"] as {
        events: {
          query: (opts: unknown) => Promise<TimelineEntry[]>;
          record: (entry: unknown) => Promise<unknown>;
        };
      };

      // Get recent timeline entries to identify active channels
      const recentEntries = await horizon.events.query({
        types: [
          TimelineEventType.Message,
          TimelineEventType.AgentResponse,
          TimelineEventType.AgentAction,
        ],
        orderBy: "desc",
        limit: 200,
      });

      // Build channel summaries from recent entries
      const channelMap = new Map<string, ChannelSummary>();
      const excludeSet = new Set(this.config.excludeChannels);

      for (const entry of recentEntries) {
        const channelKey = `${entry.platform}:${entry.channelId}`;

        // Skip excluded channels early
        if (excludeSet.has(channelKey)) continue;

        const existing = channelMap.get(channelKey);
        if (!existing) {
          const content =
            entry.type === TimelineEventType.Message
              ? (entry.data as { content?: string }).content ?? ""
              : `[${entry.type}]`;
          channelMap.set(channelKey, {
            channelKey,
            lastMessageTime: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
            lastContent: content,
            messageCount: 1,
          });
        } else {
          existing.messageCount++;
        }
      }

      const activeChannels = Array.from(channelMap.values());

      if (activeChannels.length === 0) {
        this.logger.debug("No active channels found for heartbeat");
        return;
      }

      // Evaluate channels with small model
      const modelService = this.ctx["yesimbot.model"] as unknown as {
        call: (model: string, params: unknown, fallback?: string[]) => Promise<{ text: string } | undefined>;
      };

      const selected = await evaluateChannels(
        modelService,
        this.config,
        activeChannels,
      );

      let emitted = 0;

      for (const channel of selected) {
        const channelKey = `${channel.platform}:${channel.channelId}`;

        // Check rate limit (daily ceiling)
        if (!this.checkRateLimit(channelKey)) {
          this.logger.debug(
            `Rate limit exceeded for ${channelKey}, skipping heartbeat`,
          );
          continue;
        }

        // Check TokenBucket rate limiter
        if (this.rateLimiter && !this.rateLimiter.consume(channelKey)) {
          this.logger.debug(
            `Token bucket depleted for ${channelKey}, skipping heartbeat`,
          );
          continue;
        }

        // Record HeartbeatRecord in timeline
        await horizon.events.record({
          id: Random.id(),
          type: TimelineEventType.Heartbeat,
          priority: TimelinePriority.Normal,
          stage: TimelineStage.Active,
          platform: channel.platform,
          channelId: channel.channelId,
          timestamp: new Date(),
          data: {
            triggeredBy: "global" as const,
            channelSummary: channel.reason,
          },
        });

        // Emit heartbeat event
        this.ctx.emit("athena:heartbeat", {
          platform: channel.platform,
          channelId: channel.channelId,
          triggeredBy: "global",
        });

        emitted++;
      }

      this.logger.info(
        `Heartbeat: evaluated ${activeChannels.length} channels, selected ${selected.length}, emitted ${emitted}`,
      );
    } catch (err) {
      this.logger.error(`Global heartbeat error: ${err}`);
    }
  }

  /**
   * Check if a channel has not exceeded its daily proactive message limit.
   * Resets count daily.
   *
   * @returns true if under limit, false if exceeded
   */
  checkRateLimit(channelKey: string): boolean {
    const now = Date.now();
    const entry = this.dailyMessageCounts.get(channelKey);

    if (!entry || now >= entry.resetAt) {
      // Reset or initialize - channel is under limit
      return true;
    }

    return entry.count < this.config.dailyMessageLimit;
  }

  /**
   * Record that a proactive message was sent to a channel.
   * Called by the agent pipeline after a heartbeat-triggered response.
   */
  recordProactiveMessage(channelKey: string): void {
    const now = Date.now();
    const entry = this.dailyMessageCounts.get(channelKey);

    if (!entry || now >= entry.resetAt) {
      // Start new daily window
      this.dailyMessageCounts.set(channelKey, {
        count: 1,
        resetAt: now + MS_PER_DAY,
      });
    } else {
      this.dailyMessageCounts.set(channelKey, {
        ...entry,
        count: entry.count + 1,
      });
    }
  }
}
