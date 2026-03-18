import type { FragmentStability, PromptFragment, PromptSectionName } from "../prompt/types";
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
  toolFilter: { include: string[]; exclude: string[] };
  activeSkills: Array<{ name: string; effects: string[]; metadata?: Record<string, unknown> }>;
}

export type LoadResultStatus =
  | "loaded"
  | "already_loaded"
  | "not_found"
  | "invalid_definition"
  | "rejected_by_policy"
  | "loaded_but_inactive_effects";

export interface LoadResult {
  status: LoadResultStatus;
  skill?: SkillDefinition;
  reason?: string;
}

export interface LoadAttempt {
  name: string;
  status: LoadResultStatus | "unloaded";
  timestamp: number;
  caller?: string;
  reason?: string;
}

export interface AppliedSkillEffects {
  promptFragments: PromptFragment[];
  styleFragment: PromptFragment | null;
  toolVisibility: { include: string[]; exclude: string[] };
  metadata: {
    loadedSkills: string[];
    loadHistory: LoadAttempt[];
  };
}
