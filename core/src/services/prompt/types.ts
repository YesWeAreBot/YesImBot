export type PromptSectionName = "identity" | "policy" | "memory" | "situation";

export type FragmentStability = "stable" | "dynamic";

export type FragmentSource =
  | "role"
  | "memory"
  | "scenario"
  | "capability"
  | "skill"
  | "hook"
  | "tooling";
// Canonical source union (for contract grep): type FragmentSource = "role" | "memory" | "scenario" | "capability" | "skill" | "hook" | "tooling"

export interface PromptFragment {
  id: string;
  content: string;
  section: PromptSectionName;
  source: FragmentSource;
  priority: number;
  stability: FragmentStability;
  cacheable?: boolean;
}

export type PromptLayout = readonly PromptSectionName[];

export interface RenderedPromptSection {
  name: PromptSectionName | "soul" | "instructions" | "extra";
  content: string;
  cacheable?: boolean;
}

export const PROMPT_SECTION_LAYOUT: PromptLayout = ["identity", "policy", "memory", "situation"];

export const PROMPT_FRAGMENT_SOURCE_PRECEDENCE: readonly FragmentSource[] = [
  "role",
  "memory",
  "scenario",
  "capability",
  "skill",
  "hook",
  "tooling",
];

export type Snippet = (currentScope: Record<string, unknown>) => unknown | Promise<unknown>;
