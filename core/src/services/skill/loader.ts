import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { load as yamlLoad } from "js-yaml";

import type { ConditionNode, LifecycleStrategy, SkillDefinition, StyleEffect, ToolFilter } from "./types";

interface Logger {
  warn: (msg: string, ...args: unknown[]) => void;
}

export async function loadSkillsFromDir(dir: string, logger: Logger): Promise<SkillDefinition[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const skills: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      const raw = await readFile(skillMdPath, "utf-8");
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
        effects,
        source: "file",
      };

      // Load code activator if present
      const activatorPath = resolve(join(skillDir, "scripts", "activate.js"));
      try {
        delete require.cache[activatorPath];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(activatorPath);
        const fn = mod.default ?? mod;
        if (typeof fn === "function") def.activate = fn;
      } catch {
        // No activator script — that's fine
      }

      skills.push(def);
    } catch (e) {
      logger.warn("Skipping malformed skill %s: %s", entry.name, e);
    }
  }

  return skills;
}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw.trim() };
  return { meta: (yamlLoad(match[1]) as Record<string, unknown>) ?? {}, content: match[2].trim() };
}
