import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import matter from "gray-matter";

import { INJECTION_POINTS, type PromptSectionName } from "../prompt/types";
import type {
  ConditionNode,
  LifecycleStrategy,
  SkillDefinition,
  StyleEffect,
  ToolFilter,
} from "./types";

function mapLegacyPointToSection(point: unknown): PromptSectionName | undefined {
  if (point === "soul") return "identity";
  if (point === "instructions") return "policy";
  if (point === "extra") return "situation";
  return undefined;
}

function normalizePromptSection(
  metaSection: unknown,
  legacyPoint: unknown,
  skillName: string,
): PromptSectionName {
  if (typeof metaSection === "string") {
    if ((["identity", "policy", "memory", "situation"] as const).includes(metaSection as never)) {
      return metaSection as PromptSectionName;
    }
    console.warn("Invalid prompt section '%s' in skill %s, using default", metaSection, skillName);
  }

  if (legacyPoint != null) {
    const mapped = mapLegacyPointToSection(legacyPoint);
    if (mapped) {
      console.warn("Skill %s uses deprecated alias injection_point", skillName);
      return mapped;
    }
    console.warn("Invalid injection_point '%s' in skill %s, using default", legacyPoint, skillName);
  }

  return "situation";
}

function normalizeStyleSection(
  metaSection: unknown,
  legacyPoint: unknown,
  skillName: string,
): "identity" | "policy" {
  if (metaSection === "identity" || metaSection === "policy") {
    return metaSection;
  }

  if (typeof metaSection === "string") {
    console.warn("Invalid style section '%s' in skill %s, using default", metaSection, skillName);
  }

  if (legacyPoint != null) {
    const mapped = mapLegacyPointToSection(legacyPoint);
    if (mapped === "policy") {
      console.warn("Skill %s uses deprecated alias style_injection_point", skillName);
      return "policy";
    }
    if (mapped === "identity") {
      console.warn("Skill %s uses deprecated alias style_injection_point", skillName);
      return "identity";
    }
    console.warn(
      "Invalid style_injection_point '%s' in skill %s, using default",
      legacyPoint,
      skillName,
    );
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
      const effects: SkillDefinition["effects"] = {
        prompt: content || undefined,
        style: rawEffects?.style as StyleEffect | undefined,
        tools: rawEffects?.tools as ToolFilter | undefined,
      };

      const def: SkillDefinition = {
        name: (meta.name as string) ?? entry.name,
        description: meta.description as string | undefined,
        conditions: meta.conditions as ConditionNode | undefined,
        lifecycle: (meta.lifecycle as LifecycleStrategy) ?? "per-turn",
        stickyTimeout: meta.stickyTimeout as number | undefined,
        injectionPoint:
          typeof meta.injection_point === "string" &&
          (INJECTION_POINTS as readonly string[]).includes(meta.injection_point)
            ? (meta.injection_point as "soul" | "instructions" | "extra")
            : undefined,
        styleInjectionPoint:
          typeof meta.style_injection_point === "string" &&
          (INJECTION_POINTS as readonly string[]).includes(meta.style_injection_point)
            ? (meta.style_injection_point as "soul" | "instructions" | "extra")
            : undefined,
        promptFragment: {
          section: normalizePromptSection(
            promptMeta.section,
            meta.injection_point,
            (meta.name as string) ?? entry.name,
          ),
          stability: (promptMeta.stability as "stable" | "dynamic" | undefined) ?? "dynamic",
          priority: (promptMeta.priority as number | undefined) ?? 400,
          cacheable: (promptMeta.cacheable as boolean | undefined) ?? false,
        },
        styleFragment: {
          section: normalizeStyleSection(
            styleMeta.section,
            meta.style_injection_point,
            (meta.name as string) ?? entry.name,
          ),
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
