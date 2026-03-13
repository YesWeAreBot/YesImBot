export type PromptSectionName = "identity" | "policy" | "memory" | "situation";

export type FragmentStability = "stable" | "dynamic";

export type FragmentSource =
  | "role"
  | "memory"
  | "scenario"
  | "capability"
  | "skill"
  | "hook"
  | "tooling"
  | "legacy";
// Canonical source union (for contract grep): type FragmentSource = "role" | "memory" | "scenario" | "capability" | "skill" | "hook" | "tooling" | "legacy"

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
  "legacy",
];

/**
 * @deprecated Compatibility-only alias for pre-fragment prompt sections.
 */
export type InjectionPoint = "soul" | "instructions" | "extra";

/**
 * @deprecated Compatibility-only legacy injection points.
 */
export const INJECTION_POINTS: InjectionPoint[] = ["soul", "instructions", "extra"];

/**
 * @deprecated Compatibility-only legacy injection mapping.
 */
export const LEGACY_INJECTION_POINT_SECTION_MAPPING: Record<InjectionPoint, PromptSectionName> = {
  soul: "identity",
  instructions: "policy",
  extra: "situation",
};

/**
 * @deprecated Compatibility-only entry shape for legacy inject().
 */
export interface InjectionEntry {
  name: string;
  renderFn: (scope: Record<string, unknown>) => string | Promise<string>;
  /** @deprecated Legacy-only ordering hint ignored by canonical renderer. */
  before?: string;
  /** @deprecated Legacy-only ordering hint ignored by canonical renderer. */
  after?: string;
  legacySectionHint?: "memory" | "situation";
}

/**
 * @deprecated Use RenderedPromptSection.
 */
export type Section = RenderedPromptSection;

export type Snippet = (currentScope: Record<string, unknown>) => unknown | Promise<unknown>;
