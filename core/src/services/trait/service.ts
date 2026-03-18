import { Context, Service } from "koishi";

import type { ChannelKey, Scenario } from "../../runtime/contracts";
import type { TraitSignal } from "../../shared/types";
import { HeatTrait } from "./detectors/heat";
import { SceneTrait } from "./detectors/scene";
import type { TraitDetector } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.trait": TraitAnalyzer;
  }
}

export interface TraitAnalyzerConfig {
  debugLevel?: number;
}

/**
 * Internal legacy compatibility analyzer. Not required by the agent main loop.
 * Hook authors may call `trait.analyze()` explicitly if needed, but this is
 * deprecated and will be removed in a future version.
 * @deprecated Use Scenario.raw fields directly instead of trait signals.
 */
export class TraitAnalyzer extends Service<TraitAnalyzerConfig> {
  static inject = ["yesimbot.horizon"];

  private detectors: TraitDetector[] = [];
  private stateStore = new Map<string, unknown>();

  constructor(ctx: Context, config: TraitAnalyzerConfig) {
    super(ctx, "yesimbot.trait", false);
    this.config = config;
    this.logger = ctx.logger("trait");
    this.logger.level = config.debugLevel ?? 2;
  }

  protected async start(): Promise<void> {
    this.registerDetector(new SceneTrait());
    this.registerDetector(new HeatTrait());
    this.logger.info("TraitAnalyzer started");
  }

  registerDetector(detector: TraitDetector): void {
    this.detectors.push(detector);
    detector.start(this.ctx, this);
  }

  getState<T>(detectorName: string, channelKey: string): T | undefined {
    return this.stateStore.get(`${detectorName}:${channelKey}`) as T | undefined;
  }

  setState<T>(detectorName: string, channelKey: string, state: T): void {
    this.stateStore.set(`${detectorName}:${channelKey}`, state);
  }

  async analyze(key: ChannelKey, scenario: Scenario): Promise<TraitSignal[]> {
    const results = await Promise.allSettled(
      this.detectors.map((d) => Promise.resolve(d.detect(key, scenario))),
    );
    const signals: TraitSignal[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        signals.push(...result.value);
      } else {
        this.logger.warn(`Detector failed: ${result.reason}`);
      }
    }
    return signals;
  }
}
