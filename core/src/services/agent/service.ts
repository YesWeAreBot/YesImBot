import { Context, Schema, Service } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { Percept, UserMessagePercept } from "../horizon/types";
import type { ModelService } from "../model/service";
import { ThinkActLoop } from "./loop";
import { WillingnessConfig, WillingnessEngine, WillingnessSchema } from "./willingness";

const JUDGMENT_PROMPT = `You are a conversation participation judge. Based on the conversation context and the bot's willingness score, decide whether the bot should reply.
Answer with exactly one word: "yes" or "no".`;

declare module "koishi" {
  interface Context {
    "yesimbot.agent": AgentCore;
  }
}

export interface AgentCoreConfig {
  model?: string;
  fallbackChain?: string[];
  maxRounds?: number;
  streamMode?: boolean;
  globalTimeout?: number;
  maxToolResultLength?: number;
  willingness?: WillingnessConfig;
  errorReportChannel?: string;
}

export const AgentCoreConfigSchema: Schema<AgentCoreConfig> = Schema.object({
  model: Schema.dynamic("registry.chatModels").description("Agent chat model (provider:model)"),
  fallbackChain: Schema.array(Schema.dynamic("registry.chatModels"))
    .default([])
    .description("Agent fallback chain (provider:model)"),
  maxRounds: Schema.number().default(3),
  streamMode: Schema.boolean().default(false),
  globalTimeout: Schema.number().default(120000),
  maxToolResultLength: Schema.number().default(4000),
  willingness: WillingnessSchema,
  errorReportChannel: Schema.string().description(
    "Error report channel in platform:channelId format",
  ),
});

export class AgentCore extends Service<AgentCoreConfig> {
  static inject = ["yesimbot.horizon", "yesimbot.plugin", "yesimbot.prompt", "yesimbot.model"];

  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, Percept>();
  private deferredTimers = new Map<string, () => void>();
  private deferredGen = new Map<string, number>();
  private loop!: ThinkActLoop;
  private willingness!: WillingnessEngine;

  constructor(ctx: Context, config: AgentCoreConfig) {
    super(ctx, "yesimbot.agent", false);
    this.config = config;
    this.logger = ctx.logger("agent");
  }

  protected async start(): Promise<void> {
    this.willingness = new WillingnessEngine(
      this.config.willingness ?? {
        decay: { halfLife: 300, elasticThreshold: 0.7 },
        gain: { baseGain: 15, keywordMultiplier: 1.5, keywords: [] },
        sigmoid: { midpoint: 0.5, steepness: 10 },
        fatigue: { windowMs: 120000, threshold: 3, penaltyBase: 0.5 },
        maxWillingness: 100,
        mentionBoost: 0.8,
      },
    );
    this.ctx.setInterval(() => this.willingness.tick(), 1000);
    this.loop = new ThinkActLoop(this.ctx, this.config);
    this.ctx.on("horizon/percept", (percept) => this.handlePercept(percept));
    this.logger.info("AgentCore started");
  }

  private handlePercept(percept: Percept): void {
    void this.gateAndEnqueue(percept);
  }

  private async gateAndEnqueue(percept: Percept): Promise<void> {
    try {
      const channelKey = `${percept.scope.platform}:${percept.scope.channelId}`;
      this.cancelDeferred(channelKey);
      const up = percept as UserMessagePercept;
      const result = this.willingness.processMessage(
        channelKey,
        up.triggerType,
        up.payload?.content ?? "",
      );
      const d = result.debug;
      this.logger.info(
        `[willingness] ${channelKey} | ${d.prevWillingness.toFixed(1)} → ${d.newWillingness.toFixed(1)} (+${d.gain.toFixed(1)}) | P=${result.probability.toFixed(3)} fatigue=${d.fatigue.toFixed(2)} kw=${d.keywordHit} trigger=${d.triggerType} → ${result.shouldReply ? "REPLY" : "SKIP"}`,
      );
      if (!result.shouldReply) {
        const deferred = this.config.willingness?.deferred;
        if (deferred && result.probability >= deferred.threshold) {
          this.scheduleDeferredJudgment(channelKey, percept, result.probability);
        }
        return;
      }
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
      await this.loop.run(percept);
      this.willingness.recordBotReply(channelKey);
    } catch (err: unknown) {
      this.logger.error(`runLoop error: ${err}`);
      this.logger.error(err);
      await this.reportError(err, percept).catch(() => {});
    }
  }

  private cancelDeferred(channelKey: string): void {
    const cancel = this.deferredTimers.get(channelKey);
    if (cancel) {
      cancel();
      this.deferredTimers.delete(channelKey);
      this.logger.info(`[deferred] ${channelKey} | cancelled pending judgment`);
    }
    this.deferredGen.set(channelKey, (this.deferredGen.get(channelKey) ?? 0) + 1);
  }

  private scheduleDeferredJudgment(
    channelKey: string,
    percept: Percept,
    probability: number,
  ): void {
    const { threshold, minDelayMs = 3000, maxDelayMs = 15000 } = this.config.willingness!.deferred!;
    const normalized = (probability - threshold) / (1 - threshold);
    const delay = maxDelayMs - normalized * (maxDelayMs - minDelayMs);
    this.logger.info(
      `[deferred] ${channelKey} | scheduling LLM judgment in ${delay.toFixed(0)}ms (P=${probability.toFixed(3)})`,
    );
    const gen = (this.deferredGen.get(channelKey) ?? 0) + 1;
    this.deferredGen.set(channelKey, gen);
    const cancel = this.ctx.setTimeout(async () => {
      if (!this.deferredTimers.has(channelKey)) return;
      this.deferredTimers.delete(channelKey);
      await this.executeDeferredJudgment(channelKey, percept, probability, gen);
    }, delay);
    this.deferredTimers.set(channelKey, cancel);
  }

  private async executeDeferredJudgment(
    channelKey: string,
    percept: Percept,
    probability: number,
    gen: number,
  ): Promise<void> {
    try {
      const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
      const modelService = this.ctx["yesimbot.model"] as ModelService;
      const view = await horizon.buildView(percept as UserMessagePercept);
      const contextText = horizon.formatHorizonText(view);
      const judgmentModel = this.config.willingness?.deferred?.model ?? "";
      const fallbackChain = this.config.willingness?.deferred?.fallbackChain ?? [];
      const result = await modelService.call(
        judgmentModel,
        {
          system: JUDGMENT_PROMPT,
          messages: [
            {
              role: "user" as const,
              content: `Willingness score: ${probability.toFixed(3)}\n\n${contextText}`,
            },
          ],
          maxOutputTokens: 8,
        },
        fallbackChain,
      );
      if (this.deferredGen.get(channelKey) !== gen) {
        this.logger.info(`[deferred] ${channelKey} | stale judgment (gen ${gen}), discarding`);
        return;
      }
      const answer = (result?.text ?? "").trim().toLowerCase();
      if (answer.startsWith("yes")) {
        this.logger.info(`[deferred] ${channelKey} | LLM judged YES — entering agent loop`);
        this.enqueue(channelKey, percept);
      } else {
        this.logger.info(`[deferred] ${channelKey} | LLM judged NO — staying silent`);
      }
    } catch (err: unknown) {
      this.logger.error(`[deferred] ${channelKey} | judgment failed, defaulting to SKIP: ${err}`);
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
