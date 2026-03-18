import type { FragmentStability, PromptSectionName } from "../prompt/types";
import type { SkillDefinition } from "./types";

export function normalizePromptMetadata(skill: SkillDefinition): {
  section: PromptSectionName;
  stability: FragmentStability;
  priority: number;
  cacheable: boolean;
} {
  const section = skill.promptFragment?.section ?? "situation";
  return {
    section,
    stability: skill.promptFragment?.stability ?? "dynamic",
    priority: skill.promptFragment?.priority ?? 400,
    cacheable: skill.promptFragment?.cacheable ?? false,
  };
}

export function normalizeStyleMetadata(skill: SkillDefinition): {
  section: Extract<PromptSectionName, "identity" | "policy">;
  stability: FragmentStability;
  priority: number;
  cacheable: boolean;
} {
  const section = skill.styleFragment?.section ?? "identity";
  return {
    section,
    stability: skill.styleFragment?.stability ?? "dynamic",
    priority: skill.styleFragment?.priority ?? 650,
    cacheable: skill.styleFragment?.cacheable ?? false,
  };
}
