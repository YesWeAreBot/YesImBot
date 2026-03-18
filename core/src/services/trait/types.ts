import type { ChannelKey, Scenario } from "../runtime/contracts";
import type { TraitSignal } from "../shared/types";

export interface TraitDetector {
  name: string;
  start(ctx: unknown, analyzer: unknown): void;
  detect(key: ChannelKey, scenario: Scenario): TraitSignal[] | Promise<TraitSignal[]>;
}
