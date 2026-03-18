import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import matter from "gray-matter";

import type { SkillDefinition, SkillResourceMap, SkillResourceReference } from "./types";

function normalizeAllowedTools(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const allowedTools = input.filter((entry): entry is string => typeof entry === "string");
  return allowedTools.length > 0 ? allowedTools : undefined;
}

function normalizeResourceReference(input: unknown): SkillResourceReference | null {
  if (typeof input === "string") {
    return { path: input };
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const maybeReference = input as Record<string, unknown>;
  if (typeof maybeReference.path !== "string") {
    return null;
  }

  return {
    path: maybeReference.path,
    description:
      typeof maybeReference.description === "string" ? maybeReference.description : undefined,
  };
}

function normalizeResources(input: unknown): SkillResourceMap | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const resources: SkillResourceMap = {};
  for (const [storeKey, value] of Object.entries(input as Record<string, unknown>)) {
    const reference = normalizeResourceReference(value);
    if (!reference) {
      continue;
    }
    resources[storeKey] = reference;
  }

  return Object.keys(resources).length > 0 ? resources : undefined;
}

function scanSkillResources(skillDir: string): SkillResourceMap | undefined {
  const resources: SkillResourceMap = {};

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      const relativePath = relative(skillDir, entryPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (relativePath === "scripts" || relativePath.startsWith("scripts/")) {
          continue;
        }
        walk(entryPath);
        continue;
      }

      if (relativePath === "SKILL.md") {
        continue;
      }

      resources[relativePath] = { path: relativePath };
    }
  };

  walk(skillDir);
  return Object.keys(resources).length > 0 ? resources : undefined;
}

export function loadSkillsFromDir(dir: string): SkillDefinition[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const skills: SkillDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      continue;
    }

    try {
      const raw = readFileSync(skillMdPath, "utf-8");
      const { meta, content } = parseFrontmatter(raw);
      const resources = normalizeResources(meta.resources) ?? scanSkillResources(skillDir);

      skills.push({
        name: typeof meta.name === "string" ? meta.name : entry.name,
        description: typeof meta.description === "string" ? meta.description : "",
        guidance: content.trim(),
        allowedTools: normalizeAllowedTools(meta.allowed_tools ?? meta["allowed-tools"]),
        resources,
        rootDir: skillDir,
        source: "file",
      });
    } catch (error) {
      console.warn("Skipping malformed skill %s: %s", entry.name, error);
    }
  }

  return skills;
}

function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  content: string;
} {
  const { data, content } = matter(raw);
  return { meta: data, content };
}
