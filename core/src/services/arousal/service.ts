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
    this.logger = ctx.logger("arousal");
    this.logger.level = config.debugLevel ?? 2;
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
    this.logger.info("Arousal heartbeat starting: service=arousal");

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
              ? ((entry.data as { content?: string }).content ?? "")
              : `[${entry.type}]`;
          channelMap.set(channelKey, {
            channelKey,
            lastMessageTime:
              entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
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

      const nowMs = Date.now();
      for (const channel of activeChannels) {
        const ageMs = nowMs - channel.lastMessageTime.getTime();
        const channelSummary = channel.lastContent.replace(/\s+/g, " ").slice(0, 120);
        this.logger.debug(
          `Channel evaluated: channel=${channel.channelKey} last_message_age_ms=${ageMs} message_count=${channel.messageCount} reason=${channelSummary}`,
        );
      }

      // Evaluate channels with small model
      const modelService = this.ctx["yesimbot.model"] as unknown as {
        call: (
          model: string,
          params: unknown,
          fallback?: string[],
        ) => Promise<{ text: string } | undefined>;
      };

      let selected;
      try {
        selected = await evaluateChannels(modelService, this.config, activeChannels);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Arousal evaluation failed: error=${message} channel_count=${activeChannels.length}`,
        );
        return;
      }

      let emitted = 0;
      let rateLimitedCount = 0;

      for (const channel of selected) {
        const channelKey = `${channel.platform}:${channel.channelId}`;

        this.logger.debug(`Channel selected: channel=${channelKey} reason=${channel.reason}`);

        // Check rate limit (daily ceiling)
        try {
          const dailyEntry = this.dailyMessageCounts.get(channelKey);
          const currentCount =
            !dailyEntry || Date.now() >= dailyEntry.resetAt ? 0 : dailyEntry.count;

          if (!this.checkRateLimit(channelKey)) {
            this.logger.info(
              `Rate limit: channel=${channelKey} daily_count=${currentCount} limit=${this.config.dailyMessageLimit}`,
            );
            rateLimitedCount++;
            continue;
          }

          // Check TokenBucket rate limiter
          if (this.rateLimiter && !this.rateLimiter.consume(channelKey)) {
            this.logger.info(
              `Rate limit: channel=${channelKey} daily_count=${currentCount} limit=${this.config.dailyMessageLimit} reason=token_bucket_depleted`,
            );
            rateLimitedCount++;
            continue;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Rate limit check failed: error=${message} channel=${channelKey}`);
          rateLimitedCount++;
          continue;
        }

        try {
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
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Event emission failed: error=${message} channel=${channelKey}`);
        }
      }

      this.logger.info(
        `Heartbeat: evaluated=${activeChannels.length} selected=${selected.length} emitted=${emitted} rate_limited=${rateLimitedCount}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Arousal evaluation failed: error=${message} channel_count=unknown`);
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
