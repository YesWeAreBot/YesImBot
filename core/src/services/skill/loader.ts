import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import matter from "gray-matter";

import { INJECTION_POINTS, type InjectionPoint } from "../prompt/types";
import type {
  ConditionNode,
  LifecycleStrategy,
  SkillDefinition,
  StyleEffect,
  ToolFilter,
} from "./types";

function validateInjectionPoint(val: unknown, skillName: string): InjectionPoint | undefined {
  if (val == null) return undefined;
  if (typeof val === "string" && (INJECTION_POINTS as readonly string[]).includes(val)) {
    return val as InjectionPoint;
  }
  console.warn("Invalid injection_point '%s' in skill %s, using default", val, skillName);
  return undefined;
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
        injectionPoint: validateInjectionPoint(meta.injection_point, entry.name),
        styleInjectionPoint: validateInjectionPoint(meta.style_injection_point, entry.name),
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
