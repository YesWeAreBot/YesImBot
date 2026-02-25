import { Context, Random, Schema, Service } from "koishi";

import type { HorizonService } from "../horizon/service";
import type { HorizonMessageEvent } from "../horizon/types";
import type { ModelService } from "../model/service";
import type { ToolExecutionContext } from "../plugin/types";
import type { RoleService } from "../role/service";
import type { Percept } from "../shared/types";
import { JsonParser } from "./json-parser";
import { ThinkActLoop } from "./loop";
import { TokenBucket, WillingnessConfig, WillingnessEngine, WillingnessSchema } from "./willingness";

interface JudgeResponse {
  decision: boolean;
  confidence?: number;
  reasoning?: string;
  factors?: Record<string, number>;
}

function buildJudgmentPrompt(personaSummary: string): string {
  return `You are a conversation participation judge for a chat bot.

## Bot Persona
${personaSummary}

## Task
Decide whether the bot should reply to the current conversation based on the willingness score and context.

## Judgment Factors
Consider these factors and rate each 0.0-1.0:
- mention: Was the bot directly mentioned or addressed?
- topic_relevance: Is the topic relevant to the bot's interests/expertise?
- silence_awkwardness: Would staying silent feel socially awkward?
- conversation_flow: Does the conversation naturally invite a response?

## Output Format
Respond with ONLY a JSON object:
{
  "decision": true,
  "confidence": 0.85,
  "reasoning": "Brief explanation of the decision",
  "factors": {
    "mention": 0.0,
    "topic_relevance": 0.4,
    "silence_awkwardness": 0.15,
    "conversation_flow": 0.3
  }
}

decision: true = reply, false = stay silent
confidence: 0.0-1.0 (for logging only, does not affect decision)`;
}

interface LoopPayload {
  percept: Percept;
  toolCtx: ToolExecutionContext;
}

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
  enableThoughts?: boolean;
  charBudget?: number;
  keepLastRounds?: number;
  softTrimHead?: number;
  softTrimTail?: number;
  willingness?: WillingnessConfig;
  aggregationWindow?: number;
  errorReportChannel?: string;
  debugLevel?: number;
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
  enableThoughts: Schema.boolean()
    .default(true)
    .description("Enable thoughts field in agent JSON output"),
  charBudget: Schema.number()
    .default(30000)
    .description("Character budget for working memory trimming"),
  keepLastRounds: Schema.number().default(2).description("Rounds to keep untrimmed"),
  softTrimHead: Schema.number().default(800).description("Head chars for softTrim"),
  softTrimTail: Schema.number().default(800).description("Tail chars for softTrim"),
  willingness: WillingnessSchema,
  aggregationWindow: Schema.number()
    .default(1500)
    .description("Aggregation window duration in ms for group messages"),
  errorReportChannel: Schema.string().description(
    "Error report channel in platform:channelId format",
  ),
  debugLevel: Schema.number()
    .default(0)
    .description("Debug log verbosity: 0=off, 1=basic, 2=detailed, 3=full"),
});

export class AgentCore extends Service<AgentCoreConfig> {
  static inject = [
    "yesimbot.horizon",
    "yesimbot.plugin",
    "yesimbot.prompt",
    "yesimbot.model",
    "yesimbot.trait",
    "yesimbot.skill",
    "yesimbot.role",
  ];

  private queues = new Map<string, Promise<void>>();
  private pending = new Map<string, LoopPayload>();
  private pendingWindows = new Map<
    string,
    { cancel: () => void; lastEvent: HorizonMessageEvent }
  >();
  private deferredTimers = new Map<string, () => void>();
  private deferredGen = new Map<string, number>();
  private dmWindows = new Map<string, {
    cancel: () => void;
    capCancel: () => void;
    firstMessageAt: number;
    lastMessageAt: number;
    lastEvent: HorizonMessageEvent;
    traceId: string;
  }>();
  private loop!: ThinkActLoop;
  private willingness!: WillingnessEngine;
  private rateLimiter!: { dm: TokenBucket; group: TokenBucket };
  private logWillingness;
  private logLoop;
  private logModel;
  private logParser;
  private logTool;

  constructor(ctx: Context, config: AgentCoreConfig) {
    super(ctx, "yesimbot.agent", false);
    this.config = config;
    this.logger = ctx.logger("agent");
    this.logWillingness = ctx.logger("agent.willingness");
    this.logLoop = ctx.logger("agent.loop");
    this.logModel = ctx.logger("agent.model");
    this.logParser = ctx.logger("agent.parser");
    this.logTool = ctx.logger("agent.tool");
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
    const rl = this.config.willingness?.rateLimit;
    this.rateLimiter = {
      dm: new TokenBucket(rl?.dm?.capacity ?? 5, rl?.dm?.refillRate ?? 0.5),
      group: new TokenBucket(rl?.group?.capacity ?? 10, rl?.group?.refillRate ?? 1),
    };
    this.loop = new ThinkActLoop(this.ctx, this.config);
    this.ctx.on("horizon/message", (event) => this.handleEvent(event));
    this.logger.info("AgentCore started");
  }

  private handleEvent(event: HorizonMessageEvent): void {
    try {
      const traceId = `msg-${Random.id(8, 16)}`;
      const channelKey = `${event.scope.platform}:${event.scope.channelId}`;

      // Rate limit check — before any processing
      const userId = event.payload.senderId;
      const isDirect = event.scope.isDirect;
      const bucketKey = `${event.scope.platform}:${userId}`;
      const bucket = isDirect ? this.rateLimiter.dm : this.rateLimiter.group;

      if (!bucket.consume(bucketKey)) {
        this.logger.debug(`[${traceId}] rate-limit ${bucketKey} | silently ignored`);
        return;
      }

      this.cancelDeferred(channelKey);
      const result = this.willingness.processMessage(
        channelKey,
        event.triggerType,
        event.payload.content,
      );
      const d = result.debug;
      this.logger.info(
        `[${traceId}] willingness channel=${channelKey} P=${result.probability.toFixed(3)} decision=${result.shouldReply ? "REPLY" : "SKIP"}`,
      );
      if ((this.config.debugLevel ?? 0) >= 2) {
        this.logWillingness.debug(
          `[${traceId}] prev=${d.prevWillingness.toFixed(1)} new=${d.newWillingness.toFixed(1)} gain=${d.gain.toFixed(1)} fatigue=${d.fatigue.toFixed(2)} keyword=${d.keywordHit} trigger=${d.triggerType}`,
        );
      }
      if (!result.shouldReply) {
        const deferred = this.config.willingness?.deferred;
        if (deferred && result.probability >= deferred.threshold) {
          const built = this.buildPercept(event, traceId);
          this.scheduleDeferredJudgment(channelKey, built, result.probability);
        }
        return;
      }

      // DM: adaptive aggregation window
      if (isDirect) {
        this.handleDmAggregation(channelKey, event, traceId);
        return;
      }

      // Group: aggregation window — last event wins
      const existing = this.pendingWindows.get(channelKey);
      if (existing) existing.cancel();
      const cancel = this.ctx.setTimeout(() => {
        this.pendingWindows.delete(channelKey);
        const stored = this.buildPercept(event, traceId);
        if (this.queues.has(channelKey)) {
          this.pending.set(channelKey, stored);
        } else {
          this.enqueue(channelKey, stored);
        }
      }, this.config.aggregationWindow ?? 1500);
      this.pendingWindows.set(channelKey, { cancel, lastEvent: event });
    } catch (err: unknown) {
      this.logger.error(`handleEvent error: ${err}`);
    }
  }

  private handleDmAggregation(channelKey: string, event: HorizonMessageEvent, traceId: string): void {
    const dmConfig = this.config.willingness?.dm;
    const minMs = dmConfig?.aggregationMinMs ?? 3000;
    const maxMs = dmConfig?.aggregationMaxMs ?? 8000;
    const capMs = dmConfig?.aggregationCapMs ?? 15000;

    const existing = this.dmWindows.get(channelKey);
    const now = Date.now();

    if (existing) {
      // Cancel previous adaptive timer
      existing.cancel();

      // Compute adaptive timeout based on inter-message interval
      const interval = now - existing.lastMessageAt;
      const adaptiveMs = Math.min(Math.max(interval * 1.5, minMs), maxMs);

      existing.lastMessageAt = now;
      existing.lastEvent = event;
      existing.traceId = traceId;

      // Check if cap exceeded — fire immediately
      if (now - existing.firstMessageAt >= capMs) {
        existing.capCancel();
        this.dmWindows.delete(channelKey);
        const built = this.buildPercept(event, traceId);
        if (this.queues.has(channelKey)) {
          this.pending.set(channelKey, built);
        } else {
          this.enqueue(channelKey, built);
        }
        return;
      }

      // Reset adaptive timer
      const cancel = this.ctx.setTimeout(() => {
        const win = this.dmWindows.get(channelKey);
        if (win) {
          win.capCancel();
          this.dmWindows.delete(channelKey);
          const built = this.buildPercept(win.lastEvent, win.traceId);
          if (this.queues.has(channelKey)) {
            this.pending.set(channelKey, built);
          } else {
            this.enqueue(channelKey, built);
          }
        }
      }, adaptiveMs);
      existing.cancel = cancel;
    } else {
      // First DM message — start both adaptive timer and cap timer
      const adaptiveMs = maxMs;

      const capCancel = this.ctx.setTimeout(() => {
        const win = this.dmWindows.get(channelKey);
        if (win) {
          win.cancel();
          this.dmWindows.delete(channelKey);
          const built = this.buildPercept(win.lastEvent, win.traceId);
          if (this.queues.has(channelKey)) {
            this.pending.set(channelKey, built);
          } else {
            this.enqueue(channelKey, built);
          }
        }
      }, capMs);

      const cancel = this.ctx.setTimeout(() => {
        const win = this.dmWindows.get(channelKey);
        if (win) {
          win.capCancel();
          this.dmWindows.delete(channelKey);
          const built = this.buildPercept(win.lastEvent, win.traceId);
          if (this.queues.has(channelKey)) {
            this.pending.set(channelKey, built);
          } else {
            this.enqueue(channelKey, built);
          }
        }
      }, adaptiveMs);

      this.dmWindows.set(channelKey, {
        cancel,
        capCancel,
        firstMessageAt: now,
        lastMessageAt: now,
        lastEvent: event,
        traceId,
      });
    }
  }

  private buildPercept(event: HorizonMessageEvent, traceId?: string): {
    percept: Percept;
    toolCtx: ToolExecutionContext;
  } {
    const session = event.runtime?.session;
    return {
      percept: {
        id: Random.id(),
        traceId: traceId ?? `msg-${Random.id(8, 16)}`,
        type: event.triggerType,
        scope: event.scope,
        timestamp: event.timestamp,
        metadata: {
          messageId: event.payload.messageId,
          content: event.payload.content,
          senderId: event.payload.senderId,
          senderName: event.payload.senderName,
        },
      },
      toolCtx: { scope: event.scope, session, bot: session?.bot },
    };
  }

  private enqueue(channelKey: string, built: LoopPayload): void {
    const chain = (this.queues.get(channelKey) ?? Promise.resolve())
      .then(() => this.runLoop(channelKey, built))
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

  protected async runLoop(channelKey: string, built: LoopPayload): Promise<void> {
    try {
      const startedAt = Date.now();
      const stats = await this.loop.run(built.percept, built.toolCtx);
      const latencyMs = Date.now() - startedAt;
      this.logger.info(
        `[${built.percept.traceId}] decision=RESPOND latency=${(latencyMs / 1000).toFixed(2)}s tokens=${stats.totalTokens} tools=${stats.totalToolCalls}`,
      );
      this.willingness.recordBotReply(channelKey);
    } catch (err: unknown) {
      this.logger.error(`runLoop error: ${err}`);
      this.logger.error(err);
      await this.reportError(err, built.percept).catch(() => {});
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
    built: LoopPayload,
    probability: number,
  ): void {
    const { threshold, minDelayMs = 3000, maxDelayMs = 15000 } = this.config.willingness!.deferred!;
    const normalized = (probability - threshold) / (1 - threshold);
    const delay = maxDelayMs - normalized * (maxDelayMs - minDelayMs);
    this.logger.info(
      `[${built.percept.traceId}] deferred channel=${channelKey} delay=${delay.toFixed(0)}ms P=${probability.toFixed(3)}`,
    );
    const gen = (this.deferredGen.get(channelKey) ?? 0) + 1;
    this.deferredGen.set(channelKey, gen);
    const cancel = this.ctx.setTimeout(async () => {
      if (!this.deferredTimers.has(channelKey)) return;
      this.deferredTimers.delete(channelKey);
      await this.executeDeferredJudgment(channelKey, built, probability, gen);
    }, delay);
    this.deferredTimers.set(channelKey, cancel);
  }

  private async executeDeferredJudgment(
    channelKey: string,
    built: LoopPayload,
    probability: number,
    gen: number,
  ): Promise<void> {
    try {
      const horizon = this.ctx["yesimbot.horizon"] as HorizonService;
      const modelService = this.ctx["yesimbot.model"] as ModelService;
      const view = await horizon.buildView(built.percept.scope, {
        session: built.toolCtx.session,
        selfId: built.toolCtx.bot?.selfId,
        selfName: built.toolCtx.bot?.user?.name,
      });
      const contextText = horizon.formatHorizonText(view);
      const roleService = this.ctx["yesimbot.role"] as RoleService;
      const personaSummary = roleService.getSoulSummary(300);
      const judgmentModel = this.config.willingness?.deferred?.model ?? "";
      const fallbackChain = this.config.willingness?.deferred?.fallbackChain ?? [];
      const result = await modelService.call(
        judgmentModel,
        {
          system: buildJudgmentPrompt(personaSummary),
          messages: [
            {
              role: "user" as const,
              content: `Willingness score: ${probability.toFixed(3)}\n\n${contextText}`,
            },
          ],
          maxOutputTokens: 256,
        },
        fallbackChain,
      );
      if (this.deferredGen.get(channelKey) !== gen) {
        this.logger.info(`[${built.percept.traceId}] deferred stale gen=${gen} channel=${channelKey}`);
        return;
      }
      const rawAnswer = (result?.text ?? "").trim();
      let judgeDecision = false;

      // Try structured JSON parse first
      const parser = new JsonParser<JudgeResponse>(this.logger);
      const parsed = parser.parse(rawAnswer);

      if (parsed.data && typeof parsed.data.decision === "boolean") {
        judgeDecision = parsed.data.decision;
        // Log structured response at debugLevel >= 1
        if ((this.config.debugLevel ?? 0) >= 1) {
          const traceId = built.percept.traceId;
          this.logWillingness.debug(
            `[${traceId}] judge decision=${judgeDecision} confidence=${parsed.data.confidence?.toFixed(2) ?? "?"} reasoning="${(parsed.data.reasoning ?? "").slice(0, 100)}"`,
          );
        }
        if ((this.config.debugLevel ?? 0) >= 2 && parsed.data.factors) {
          const traceId = built.percept.traceId;
          const fKv = Object.entries(parsed.data.factors)
            .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`)
            .join(" ");
          this.logWillingness.debug(`[${traceId}] judge_factors ${fKv}`);
        }
      } else {
        // Legacy fallback: bare yes/no string
        judgeDecision = rawAnswer.toLowerCase().startsWith("yes");
        this.logger.info(`[deferred] ${channelKey} | legacy parse fallback, raw="${rawAnswer.slice(0, 50)}"`);
      }

      if (judgeDecision) {
        this.logger.info(`[deferred] ${channelKey} | judge=YES — entering agent loop`);
        this.enqueue(channelKey, built);
      } else {
        this.logger.info(`[deferred] ${channelKey} | judge=NO — staying silent`);
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
