import { Schema } from "koishi";

import type { TriggerType } from "../horizon/types";

interface ChannelState {
  willingness: number;
  lastMessageAt: number;
  botReplyTimestamps: number[];
}

export interface DeferredJudgmentConfig {
  threshold: number;
  minDelayMs: number;
  maxDelayMs: number;
  model?: string;
  fallbackChain?: string[];
}

export interface WillingnessConfig {
  decay: {
    halfLife: number;
    elasticThreshold: number;
  };
  gain: {
    baseGain: number;
    keywordMultiplier: number;
    keywords: string[];
  };
  sigmoid: {
    midpoint: number;
    steepness: number;
  };
  fatigue: {
    windowMs: number;
    threshold: number;
    penaltyBase: number;
  };
  maxWillingness: number;
  mentionBoost: number;
  deferred?: DeferredJudgmentConfig;
}

export const WillingnessSchema: Schema<WillingnessConfig> = Schema.intersect([
  Schema.object({
    maxWillingness: Schema.number().default(100).description("Maximum willingness value cap"),
    mentionBoost: Schema.number().default(0.8).description("Probability boost on @mention (0-1)"),
  }),
  Schema.object({
    decay: Schema.object({
      halfLife: Schema.number().default(300).description("Willingness half-life in seconds"),
      elasticThreshold: Schema.number()
        .default(0.7)
        .description("Ratio of max above which decay is halved"),
    }).description("Decay settings"),
  }),
  Schema.object({
    gain: Schema.object({
      baseGain: Schema.number().default(15).description("Willingness added per message"),
      keywordMultiplier: Schema.number()
        .default(1.5)
        .description("Gain multiplier when keyword matches"),
      keywords: Schema.array(Schema.string())
        .default([])
        .description("Regex patterns that boost gain"),
    }).description("Gain settings"),
  }),
  Schema.object({
    sigmoid: Schema.object({
      midpoint: Schema.number()
        .default(0.5)
        .description("Willingness ratio where gain multiplier = 1"),
      steepness: Schema.number().default(10).description("Sigmoid curve steepness"),
    }).description("Sigmoid gain curve settings"),
  }),
  Schema.object({
    fatigue: Schema.object({
      windowMs: Schema.number().default(120000).description("Sliding window duration in ms"),
      threshold: Schema.number().default(3).description("Bot replies before fatigue penalty"),
      penaltyBase: Schema.number()
        .default(0.5)
        .description("Exponential penalty base per excess reply"),
    }).description("Fatigue settings"),
  }),
  Schema.object({
    deferred: Schema.object({
      threshold: Schema.number()
        .default(0.3)
        .description("Probability threshold to trigger deferred judgment"),
      minDelayMs: Schema.number()
        .default(3000)
        .description("Minimum delay before LLM judgment (ms)"),
      maxDelayMs: Schema.number()
        .default(15000)
        .description("Maximum delay before LLM judgment (ms)"),
      model: Schema.dynamic("registry.chatModels").description(
        "Model for deferred LLM judgment (overrides willingness model)",
      ),
      fallbackChain: Schema.array(Schema.dynamic("registry.chatModels"))
        .default([])
        .description("Willingness fallback chain (provider:model)"),
    }).description("Deferred LLM judgment for borderline SKIP decisions"),
  }),
]);

function computeDecayFactor(
  baseFactor: number,
  willingness: number,
  elasticThreshold: number,
  maxWillingness: number,
  silenceMs: number,
): number {
  let factor = baseFactor;

  if (willingness > elasticThreshold * maxWillingness) {
    factor = 1.0 - (1.0 - factor) * 0.5;
  }

  if (silenceMs <= 5000) {
    factor = 1.0 - (1.0 - factor) * 0.1;
  } else if (silenceMs <= 15000) {
    factor = 1.0 - (1.0 - factor) * 0.3;
  } else if (silenceMs <= 60000) {
    factor = 1.0 - (1.0 - factor) * 0.7;
  }

  return factor;
}

function sigmoidGainMultiplier(
  current: number,
  max: number,
  midpoint: number,
  steepness: number,
): number {
  const ratio = current / max;
  const raw = 1 / (1 + Math.exp(steepness * (ratio - midpoint)));
  return raw * 2;
}

function computeFatiguePenalty(
  botReplyTimestamps: number[],
  now: number,
  windowMs: number,
  threshold: number,
  penaltyBase: number,
): number {
  const recent = botReplyTimestamps.filter((t) => now - t < windowMs);
  const excess = recent.length - threshold;
  if (excess <= 0) return 1.0;
  return Math.pow(penaltyBase, excess);
}

function applyMentionBoost(baseProbability: number, mentionBoost: number): number {
  return baseProbability + (1 - baseProbability) * mentionBoost;
}

export interface WillingnessResult {
  probability: number;
  shouldReply: boolean;
  debug: {
    prevWillingness: number;
    newWillingness: number;
    gain: number;
    keywordHit: boolean;
    fatigue: number;
    triggerType: TriggerType;
  };
}

export class WillingnessEngine {
  private channels = new Map<string, ChannelState>();
  private baseFactor: number;
  private keywordRegexes: RegExp[];

  constructor(private config: WillingnessConfig) {
    this.baseFactor = Math.pow(0.5, 1 / config.decay.halfLife);
    this.keywordRegexes = config.gain.keywords.map((p) => new RegExp(p));
  }

  tick(): void {
    const now = Date.now();
    for (const [key, state] of this.channels) {
      const silenceMs = now - state.lastMessageAt;
      const factor = computeDecayFactor(
        this.baseFactor,
        state.willingness,
        this.config.decay.elasticThreshold,
        this.config.maxWillingness,
        silenceMs,
      );
      state.willingness *= factor;
      state.botReplyTimestamps = state.botReplyTimestamps.filter(
        (t) => now - t < this.config.fatigue.windowMs,
      );
      if (state.willingness < 0.01 && state.botReplyTimestamps.length === 0) {
        this.channels.delete(key);
      }
    }
  }

  processMessage(channelKey: string, triggerType: TriggerType, content: string): WillingnessResult {
    const state = this.channels.get(channelKey) ?? {
      willingness: 0,
      lastMessageAt: 0,
      botReplyTimestamps: [],
    };
    this.channels.set(channelKey, state);

    const prevWillingness = state.willingness;
    state.lastMessageAt = Date.now();

    let gain = this.config.gain.baseGain;
    const keywordHit = this.keywordRegexes.some((re) => re.test(content));
    if (keywordHit) gain *= this.config.gain.keywordMultiplier;
    gain *= sigmoidGainMultiplier(
      state.willingness,
      this.config.maxWillingness,
      this.config.sigmoid.midpoint,
      this.config.sigmoid.steepness,
    );

    state.willingness = Math.min(this.config.maxWillingness, Math.max(0, state.willingness + gain));

    let probability = state.willingness / this.config.maxWillingness;
    const fatigue = computeFatiguePenalty(
      state.botReplyTimestamps,
      Date.now(),
      this.config.fatigue.windowMs,
      this.config.fatigue.threshold,
      this.config.fatigue.penaltyBase,
    );
    probability *= fatigue;

    if (triggerType === "mention" || triggerType === "reply") {
      probability = applyMentionBoost(probability, this.config.mentionBoost);
    }

    const shouldReply = Math.random() < probability;
    return {
      probability,
      shouldReply,
      debug: {
        prevWillingness,
        newWillingness: state.willingness,
        gain,
        keywordHit,
        fatigue,
        triggerType,
      },
    };
  }

  recordBotReply(channelKey: string): void {
    const state = this.channels.get(channelKey);
    if (state) state.botReplyTimestamps.push(Date.now());
  }
}
