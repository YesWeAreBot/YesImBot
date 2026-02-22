import type { TraitSignal } from "../shared/types";
import type { ConditionNode } from "./types";

export function evaluateCondition(node: ConditionNode, signals: TraitSignal[]): boolean {
  if ("match" in node)
    return signals.some(s => s.dimension === node.match.dimension && s.value === node.match.value);
  if ("and" in node) return node.and.every(c => evaluateCondition(c, signals));
  if ("or" in node) return node.or.some(c => evaluateCondition(c, signals));
  if ("not" in node) return !evaluateCondition(node.not, signals);
  return false;
}

export function specificity(node: ConditionNode): number {
  if ("match" in node) return 1;
  if ("and" in node) return node.and.reduce((s, c) => s + specificity(c), 0);
  if ("or" in node) return Math.max(...node.or.map(specificity));
  if ("not" in node) return specificity(node.not);
  return 0;
}

export function filterByConfidence(signals: TraitSignal[], threshold: number): TraitSignal[] {
  return signals.filter(s => s.confidence >= threshold);
}
