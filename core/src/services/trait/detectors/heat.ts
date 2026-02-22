import type { Context, Logger } from "koishi";

import type { HorizonView } from "../../horizon/types";
import type { Scope, TraitSignal } from "../../shared/types";
import type { TraitAnalyzer } from "../service";
import type { TraitDetector } from "../types";

interface HeatState {
  timestamps: number[];
}

const WINDOW_MS = 5 * 60 * 1000;
const HIGH_THRESHOLD = 8;
const MEDIUM_THRESHOLD = 2;

function channelKey(scope: Scope): string {
  return `${scope.platform}:${scope.channelId}`;
}

export class HeatTrait implements TraitDetector {
  name = "heat";
  private analyzer!: TraitAnalyzer;
  private logger!: Logger;

  start(ctx: unknown, analyzer: unknown): void {
    const context = ctx as Context;
    this.analyzer = analyzer as TraitAnalyzer;
    this.logger = context.logger("trait:heat");

    context.on("horizon/message", (event) => {
      const key = channelKey(event.scope);
      const state = this.analyzer.getState<HeatState>(this.name, key) ?? { timestamps: [] };
      const now = Date.now();

      state.timestamps.push(now);
      state.timestamps = state.timestamps.filter((t) => now - t <= WINDOW_MS);

      this.analyzer.setState(this.name, key, state);
    });
  }

  detect(scope: Scope, _view: HorizonView): TraitSignal[] {
    const key = channelKey(scope);
    const state = this.analyzer.getState<HeatState>(this.name, key);

    if (!state || state.timestamps.length === 0) {
      return [
        { dimension: "heat", value: "low", confidence: 1.0 },
        { dimension: "heat-trend", value: "stable", confidence: 1.0 },
      ];
    }

    const now = Date.now();
    const recent = state.timestamps.filter((t) => now - t <= WINDOW_MS);
    const windowMinutes = WINDOW_MS / 60000;
    const rate = recent.length / windowMinutes;

    // Level
    const level = rate >= HIGH_THRESHOLD ? "high" : rate >= MEDIUM_THRESHOLD ? "medium" : "low";

    // Trend: split at midpoint
    const midpoint = now - WINDOW_MS / 2;
    const olderHalf = recent.filter((t) => t <= midpoint).length;
    const recentHalf = recent.filter((t) => t > midpoint).length;

    let trend = "stable";
    if (olderHalf > 0 && recentHalf > olderHalf * 1.3) trend = "heating";
    else if (olderHalf > 0 && recentHalf < olderHalf * 0.7) trend = "cooling";

    return [
      { dimension: "heat", value: level, confidence: 0.9 },
      { dimension: "heat-trend", value: trend, confidence: 0.8 },
    ];
  }
}
