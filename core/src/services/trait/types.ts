import type { HorizonView } from "../horizon/types";
import type { Scope, TraitSignal } from "../shared/types";

export interface TraitDetector {
  name: string;
  start(ctx: unknown, analyzer: unknown): void;
  detect(scope: Scope, view: HorizonView): TraitSignal[] | Promise<TraitSignal[]>;
}
