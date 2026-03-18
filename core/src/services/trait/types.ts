import type { HorizonView } from "../horizon/types";
import type { ChannelKey, TraitSignal } from "../shared/types";

export interface TraitDetector {
  name: string;
  start(ctx: unknown, analyzer: unknown): void;
  detect(key: ChannelKey, view: HorizonView): TraitSignal[] | Promise<TraitSignal[]>;
}
