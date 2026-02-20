import { Schema } from "koishi";

export interface DeferredJudgmentConfig {
  threshold: number;
  minDelayMs: number;
  maxDelayMs: number;
  judgmentModel?: string;
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
  judgmentModel?: string;
  fallbackChain?: string[];
}

export const WillingnessSchema = Schema.intersect([
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
    judgmentModel: Schema.dynamic("registry.chatModels").description("Model for willingness LLM judgment"),
    fallbackChain: Schema.array(Schema.string()).default([]).description("Willingness fallback chain (provider:model)"),
    deferred: Schema.object({
      threshold: Schema.number().default(0.3).description("Probability threshold to trigger deferred judgment"),
      minDelayMs: Schema.number().default(3000).description("Minimum delay before LLM judgment (ms)"),
      maxDelayMs: Schema.number().default(15000).description("Maximum delay before LLM judgment (ms)"),
      judgmentModel: Schema.dynamic("registry.chatModels").description("Model for deferred LLM judgment (overrides willingness model)"),
    }).description("Deferred LLM judgment for borderline SKIP decisions"),
  }),
]);
