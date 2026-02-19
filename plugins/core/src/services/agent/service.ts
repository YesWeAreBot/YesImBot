import { Context, Service } from "koishi";

import type { Percept, UserMessagePercept } from "../horizon/types";
import type { AgentCoreConfig } from "./config";
import { ThinkActLoop } from "./loop";
import { WillingnessEngine } from "./willingness";

declare module "koishi" {
  interface Context {
    "yesimbot.agent": AgentCore;
  }
}

export class AgentCore extends Service<AgentCoreConfig> {
  static inject = ["yesimbot.horizon", "yesimbot.plugin", "yesimbot.prompt", "yesimbot.model"];

  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, Percept>();
  private loop!: ThinkActLoop;
  private willingness!: WillingnessEngine;

  constructor(ctx: Context, config: AgentCoreConfig) {
    super(ctx, "yesimbot.agent", false);
    this.config = config;
    this.logger = ctx.logger("agent");
  }

  protected async start(): Promise<void> {
    this.willingness = new WillingnessEngine(this.config.willingness ?? {
      decay: { halfLife: 300, elasticThreshold: 0.7 },
      gain: { baseGain: 15, keywordMultiplier: 1.5, keywords: [] },
      sigmoid: { midpoint: 0.5, steepness: 10 },
      fatigue: { windowMs: 120000, threshold: 3, penaltyBase: 0.5 },
      maxWillingness: 100,
      mentionBoost: 0.8,
    });
    this.ctx.setInterval(() => this.willingness.tick(), 1000);
    this.loop = new ThinkActLoop(this.ctx);
    this.ctx.on("horizon/percept", (percept) => this.handlePercept(percept));
    this.logger.info("AgentCore started");
  }

  private handlePercept(percept: Percept): void {
    void this.gateAndEnqueue(percept);
  }

  private async gateAndEnqueue(percept: Percept): Promise<void> {
    try {
      const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
      const up = percept as UserMessagePercept;
      const { shouldReply } = this.willingness.processMessage(channelKey, up.triggerType, up.payload?.content ?? "");
      if (!shouldReply) return;
      if (this.queues.has(channelKey)) {
        this.pending.set(channelKey, percept);
      } else {
        this.enqueue(channelKey, percept);
      }
    } catch (err: unknown) {
      this.logger.error(`gateAndEnqueue error: ${err}`);
    }
  }

  private enqueue(channelKey: string, percept: Percept): void {
    const chain = (this.queues.get(channelKey) ?? Promise.resolve())
      .then(() => this.runLoop(channelKey, percept))
      .then(() => {
        const next = this.pending.get(channelKey);
        if (next) {
          this.pending.delete(channelKey);
          this.enqueue(channelKey, next);
        }
      })
      .catch((err: unknown) => this.logger.error(`AgentCore queue error: ${err}`))
      .finally(() => {
        if (this.queues.get(channelKey) === chain) this.queues.delete(channelKey);
      });
    this.queues.set(channelKey, chain);
  }

  protected async runLoop(channelKey: string, percept: Percept): Promise<void> {
    try {
      await this.loop.run(percept, this.config);
      this.willingness.recordBotReply(channelKey);
    } catch (err: unknown) {
      this.logger.error(`runLoop error: ${err}`);
      this.logger.error(err);
      await this.reportError(err, percept).catch(() => {});
    }
  }

  private async reportError(err: unknown, percept: Percept): Promise<void> {
    if (!this.config.errorReportChannel) return;
    const colonIdx = this.config.errorReportChannel.indexOf(":");
    const platform = this.config.errorReportChannel.slice(0, colonIdx);
    const channelId = this.config.errorReportChannel.slice(colonIdx + 1);
    const bot = this.ctx.bots.find((b) => b.platform === platform);
    if (!bot) return;
    const summary = `[Error] ${percept.scope.channelId}: ${err instanceof Error ? err.message : String(err)}`;
    await bot.sendMessage(channelId, summary).catch(() => {});
  }
}
