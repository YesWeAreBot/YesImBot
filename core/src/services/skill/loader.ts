import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import matter from "gray-matter";

import type { PromptSectionName } from "../prompt/types";
import type {
  ConditionNode,
  LifecycleStrategy,
  SkillDefinition,
  StyleEffect,
  ToolFilter,
} from "./types";

function normalizePromptSection(metaSection: unknown, skillName: string): PromptSectionName {
  if (typeof metaSection === "string") {
    if ((["identity", "policy", "memory", "situation"] as const).includes(metaSection as never)) {
      return metaSection as PromptSectionName;
    }
    console.warn("Invalid prompt section '%s' in skill %s, using default", metaSection, skillName);
  }

  return "situation";
}

function normalizeStyleSection(metaSection: unknown, skillName: string): "identity" | "policy" {
  if (metaSection === "identity" || metaSection === "policy") {
    return metaSection;
  }

  if (typeof metaSection === "string") {
    console.warn("Invalid style section '%s' in skill %s, using default", metaSection, skillName);
  }

  return "identity";
}

export function loadSkillsFromDir(dir: string): SkillDefinition[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const skills: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      const raw = readFileSync(skillMdPath, "utf-8");
      const { meta, content } = parseFrontmatter(raw);

      const rawEffects = meta.effects as Record<string, unknown> | undefined;
      const promptMeta = (meta.prompt_fragment ?? {}) as Record<string, unknown>;
      const styleMeta = (meta.style_fragment ?? {}) as Record<string, unknown>;
      const skillName = (meta.name as string) ?? entry.name;

      if (meta.injection_point != null) {
        console.warn(
          "Skill %s has deprecated injection_point field; use prompt_fragment.section instead",
          skillName,
        );
      }
      if (meta.style_injection_point != null) {
        console.warn(
          "Skill %s has deprecated style_injection_point field; use style_fragment.section instead",
          skillName,
        );
      }

      const effects: SkillDefinition["effects"] = {
        prompt: content || undefined,
        style: rawEffects?.style as StyleEffect | undefined,
        tools: rawEffects?.tools as ToolFilter | undefined,
      };

      const def: SkillDefinition = {
        name: skillName,
        description: meta.description as string | undefined,
        conditions: meta.conditions as ConditionNode | undefined,
        lifecycle: (meta.lifecycle as LifecycleStrategy) ?? "per-turn",
        stickyTimeout: meta.stickyTimeout as number | undefined,
        promptFragment: {
          section: normalizePromptSection(promptMeta.section, skillName),
          stability: (promptMeta.stability as "stable" | "dynamic" | undefined) ?? "dynamic",
          priority: (promptMeta.priority as number | undefined) ?? 400,
          cacheable: (promptMeta.cacheable as boolean | undefined) ?? false,
        },
        styleFragment: {
          section: normalizeStyleSection(styleMeta.section, skillName),
          stability: (styleMeta.stability as "stable" | "dynamic" | undefined) ?? "dynamic",
          priority: (styleMeta.priority as number | undefined) ?? 650,
          cacheable: (styleMeta.cacheable as boolean | undefined) ?? false,
        },
        effects,
        source: "file",
      };

      // Load code activator if present (.cjs preferred, .js fallback)
      for (const ext of ["activate.cjs", "activate.js"]) {
        const activatorPath = resolve(join(skillDir, "scripts", ext));
        if (!existsSync(activatorPath)) continue;
        try {
          delete require.cache[activatorPath];
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = require(activatorPath);
          const fn = mod.default ?? mod;
          if (typeof fn === "function") def.activate = fn;
        } catch (e) {
          console.warn("Failed to load activator for %s: %s", entry.name, e);
        }
        break;
      }

      skills.push(def);
    } catch (e) {
      console.warn("Skipping malformed skill %s: %s", entry.name, e);
    }
  }

  return skills;
}

function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  content: string;
} {
  const { data, content } = matter(raw);
  return { meta: data, content: content.trim() };
}
