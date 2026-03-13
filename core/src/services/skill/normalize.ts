import type { FragmentStability, PromptSectionName } from "../prompt/types";
import type { SkillDefinition } from "./types";

export function mapLegacyPointToSection(
  point: SkillDefinition["injectionPoint"] | SkillDefinition["styleInjectionPoint"],
): PromptSectionName {
  if (point === "soul") return "identity";
  if (point === "instructions") return "policy";
  return "situation";
}

export function mapSectionToLegacyPoint(
  section: PromptSectionName,
): "soul" | "instructions" | "extra" {
  if (section === "identity") return "soul";
  if (section === "policy") return "instructions";
  return "extra";
}

export function normalizePromptMetadata(skill: SkillDefinition): {
  section: PromptSectionName;
  stability: FragmentStability;
  priority: number;
  cacheable: boolean;
} {
  const section = skill.promptFragment?.section ?? mapLegacyPointToSection(skill.injectionPoint);
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
  const legacySection = mapLegacyPointToSection(skill.styleInjectionPoint);
  const section =
    skill.styleFragment?.section ?? (legacySection === "policy" ? "policy" : "identity");
  return {
    section,
    stability: skill.styleFragment?.stability ?? "dynamic",
    priority: skill.styleFragment?.priority ?? 650,
    cacheable: skill.styleFragment?.cacheable ?? false,
  };
}
