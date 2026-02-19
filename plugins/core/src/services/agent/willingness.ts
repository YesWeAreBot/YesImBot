import type { TriggerType } from "../horizon/types";
import type { WillingnessConfig } from "./willingness-config";

interface ChannelState {
  willingness: number;
  lastMessageAt: number;
  botReplyTimestamps: number[];
}

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

function sigmoidGainMultiplier(current: number, max: number, midpoint: number, steepness: number): number {
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
  const recent = botReplyTimestamps.filter(t => now - t < windowMs);
  const excess = recent.length - threshold;
  if (excess <= 0) return 1.0;
  return Math.pow(penaltyBase, excess);
}

function applyMentionBoost(baseProbability: number, mentionBoost: number): number {
  return baseProbability + (1 - baseProbability) * mentionBoost;
}

export class WillingnessEngine {
  private channels = new Map<string, ChannelState>();
  private baseFactor: number;

  constructor(private config: WillingnessConfig) {
    this.baseFactor = Math.pow(0.5, 1 / config.decay.halfLife);
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
      state.botReplyTimestamps = state.botReplyTimestamps.filter(t => now - t < this.config.fatigue.windowMs);
      if (state.willingness < 0.01 && state.botReplyTimestamps.length === 0) {
        this.channels.delete(key);
      }
    }
  }

  processMessage(
    channelKey: string,
    triggerType: TriggerType,
    content: string,
  ): { probability: number; shouldReply: boolean } {
    const state = this.channels.get(channelKey) ?? { willingness: 0, lastMessageAt: 0, botReplyTimestamps: [] };
    this.channels.set(channelKey, state);

    state.lastMessageAt = Date.now();

    let gain = this.config.gain.baseGain;
    if (this.config.gain.keywords.some(pattern => new RegExp(pattern).test(content))) {
      gain *= this.config.gain.keywordMultiplier;
    }
    gain *= sigmoidGainMultiplier(state.willingness, this.config.maxWillingness, this.config.sigmoid.midpoint, this.config.sigmoid.steepness);

    state.willingness = Math.min(this.config.maxWillingness, Math.max(0, state.willingness + gain));

    let probability = state.willingness / this.config.maxWillingness;
    probability *= computeFatiguePenalty(state.botReplyTimestamps, Date.now(), this.config.fatigue.windowMs, this.config.fatigue.threshold, this.config.fatigue.penaltyBase);

    if (triggerType === "mention" || triggerType === "reply") {
      probability = applyMentionBoost(probability, this.config.mentionBoost);
    }

    const shouldReply = Math.random() < probability;
    return { probability, shouldReply };
  }

  recordBotReply(channelKey: string): void {
    const state = this.channels.get(channelKey);
    if (state) state.botReplyTimestamps.push(Date.now());
  }
}
