import type { FragmentStability, PromptSectionName } from "../prompt/types";
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
  promptFragment?: SkillFragmentMetadata;
  styleFragment?: SkillStyleFragmentMetadata;
  /** @deprecated use promptFragment.section */
  injectionPoint?: "soul" | "instructions" | "extra";
  /** @deprecated use styleFragment.section */
  styleInjectionPoint?: "soul" | "instructions" | "extra";
  effects: SkillEffects;
  source: "file" | "plugin";
}

export interface SkillFragmentMetadata {
  section: PromptSectionName;
  stability?: FragmentStability;
  priority?: number;
  cacheable?: boolean;
}

export interface SkillStyleFragmentMetadata {
  section?: Extract<PromptSectionName, "identity" | "policy">;
  stability?: FragmentStability;
  priority?: number;
  cacheable?: boolean;
}

export interface SkillPromptFragment {
  skillName: string;
  content: string;
  section: PromptSectionName;
  source: "skill";
  stability: FragmentStability;
  priority: number;
  cacheable: boolean;
}

// ---- Merged Result ----

export interface SkillEffect {
  promptFragments: SkillPromptFragment[];
  styleFragment: (SkillPromptFragment & { specificity: number }) | null;
  /** @deprecated compatibility alias; use promptFragments */
  promptInjections: Array<{
    skillName: string;
    point: "soul" | "instructions" | "extra";
    content: string;
  }>;
  /** @deprecated compatibility alias; use styleFragment */
  styleOverride: {
    content: string;
    specificity: number;
    point: "soul" | "instructions" | "extra";
  } | null;
  toolFilter: { include: string[]; exclude: string[] };
  activeSkills: Array<{ name: string; effects: string[]; metadata?: Record<string, unknown> }>;
}
