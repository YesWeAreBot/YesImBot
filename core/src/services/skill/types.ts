import type { InjectionPoint } from "../prompt/types";
import type { TraitSignal } from "../shared/types";

// ---- Condition Nodes ----

export interface MatchNode {
  match: { dimension: string; value: string };
}

export interface AndNode {
  and: ConditionNode[];
}

export interface OrNode {
  or: ConditionNode[];
}

export interface NotNode {
  not: ConditionNode;
}

export type ConditionNode = MatchNode | AndNode | OrNode | NotNode;

// ---- Skill Definition ----

export type LifecycleStrategy = "per-turn" | "sticky" | "trait-bound";

export interface StyleEffect {
  content: string;
}

export interface ToolFilter {
  include?: string[];
  exclude?: string[];
}

export interface SkillEffects {
  prompt?: string;
  style?: StyleEffect;
  tools?: ToolFilter;
}

export interface SkillDefinition {
  name: string;
  description?: string;
  conditions?: ConditionNode;
  activate?: (signals: TraitSignal[]) => boolean;
  lifecycle: LifecycleStrategy;
  stickyTimeout?: number;
  injectionPoint?: InjectionPoint;
  styleInjectionPoint?: InjectionPoint;
  effects: SkillEffects;
  source: "file" | "plugin";
}

// ---- Merged Result ----

export interface SkillEffect {
  promptInjections: Array<{
    skillName: string;
    point: InjectionPoint;
    content: string;
  }>;
  styleOverride: {
    content: string;
    specificity: number;
    point: InjectionPoint;
  } | null;
  toolFilter: { include: string[]; exclude: string[] };
  activeSkills: Array<{ name: string; effects: string[]; metadata?: Record<string, unknown> }>;
}
