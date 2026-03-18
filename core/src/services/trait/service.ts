import { Context, Schema, Service } from "koishi";

import type { ChannelKey, Scenario } from "../runtime/contracts";
import type { TraitSignal } from "../shared/types";
import { HeatTrait } from "./detectors/heat";
import { SceneTrait } from "./detectors/scene";
import type { TraitDetector } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.trait": TraitAnalyzer;
  }
}

export interface TraitAnalyzerConfig {}

export const TraitAnalyzerConfigSchema: Schema<TraitAnalyzerConfig> = Schema.object({});

/**
 * Optional analyzer. Not required by the agent main loop.
 * Hook authors may call `trait.analyze()` explicitly when they need
 * trait signals to decide skill loading.
 */
export class TraitAnalyzer extends Service<TraitAnalyzerConfig> {
  static inject = ["yesimbot.horizon"];

  private detectors: TraitDetector[] = [];
  private stateStore = new Map<string, unknown>();

  constructor(ctx: Context, config: TraitAnalyzerConfig) {
    super(ctx, "yesimbot.trait", false);
    this.logger = ctx.logger("trait");
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
