import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { LocalFilesystem } from "./filesystem";
import { createWorkspaceBoundaryError, normalizeWorkspacePath, withinBasePath } from "./helpers";
import type { SkillRecord } from "./types";

async function readSkillFile(skillPath: string): Promise<string> {
  return readFile(skillPath, "utf8");
}

export class WorkspaceSkills {
  constructor(
    private readonly skills?: string[],
    private readonly filesystem?: LocalFilesystem,
  ) {}

  isEnabled(): boolean {
    return !!this.skills && this.skills.length > 0;
  }

  private getSkillRoots(): string[] {
    if (!this.skills || this.skills.length === 0) {
      return [];
    }

    const filesystem = this.filesystem;
    if (filesystem) {
      return this.skills.map((skillPath) => filesystem.resolvePath(skillPath));
    }

    return this.skills.map((skillPath) => resolve(skillPath));
  }

  async collectSkills(): Promise<SkillRecord[]> {
    const skillRoots = this.getSkillRoots();
    const records: SkillRecord[] = [];

    for (const rootPath of skillRoots) {
      const currentStat = await stat(rootPath);
      if (currentStat.isFile() && basename(rootPath) === "SKILL.md") {
        records.push({
          name: basename(dirname(rootPath)),
          rootPath: dirname(rootPath),
          skillFile: rootPath,
        });
        continue;
      }

      const directSkillFile = join(rootPath, "SKILL.md");
      try {
        const directSkillStat = await stat(directSkillFile);
        if (directSkillStat.isFile()) {
          records.push({
            name: basename(rootPath),
            rootPath,
            skillFile: directSkillFile,
          });
          continue;
        }
      } catch {
        // Ignore and continue recursive discovery.
      }

      const children = await readdir(rootPath, { withFileTypes: true });
      for (const child of children) {
        if (!child.isDirectory()) {
          continue;
        }

        const skillRoot = join(rootPath, child.name);
        const skillFile = join(skillRoot, "SKILL.md");
        try {
          const skillFileStat = await stat(skillFile);
          if (skillFileStat.isFile()) {
            records.push({
              name: child.name,
              rootPath: skillRoot,
              skillFile,
            });
          }
        } catch {
          // Ignore non-skill sub-directories.
        }
      }
    }

    return records;
  }

  async resolveSkill(name: string): Promise<SkillRecord> {
    const skills = await this.collectSkills();
    const skill = skills.find((item) => item.name === name || item.rootPath === resolve(name));
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }
    return skill;
  }

  async loadSkill(name: string): Promise<{ name: string; content: string }> {
    const skill = await this.resolveSkill(name);
    return {
      name: skill.name,
      content: await readSkillFile(skill.skillFile),
    };
  }

  async readSkill(
    name: string,
    path: string,
  ): Promise<{ name: string; path: string; content: string }> {
    const skill = await this.resolveSkill(name);
    const relativePath = normalizeWorkspacePath(path);
    const targetPath = resolve(skill.rootPath, relativePath);
    if (!withinBasePath(targetPath, skill.rootPath)) {
      throw createWorkspaceBoundaryError(path);
    }

    return {
      name: skill.name,
      path,
      content: await readSkillFile(targetPath),
    };
  }

  async searchSkillContent(
    query: string,
    options?: { name?: string; topK?: number },
  ): Promise<Array<{ name: string; path: string; content: string }>> {
    const skills = await this.collectSkills();
    const filteredSkills = options?.name
      ? skills.filter((skill) => skill.name === options.name)
      : skills;
    const topK = options?.topK ?? 5;
    const normalizedQuery = query.toLowerCase();
    const matches: Array<{ name: string; path: string; content: string }> = [];

    for (const skill of filteredSkills) {
      const content = await readSkillFile(skill.skillFile);
      if (content.toLowerCase().includes(normalizedQuery)) {
        matches.push({
          name: skill.name,
          path: skill.skillFile,
          content,
        });
      }

      if (matches.length >= topK) {
        break;
      }
    }

    return matches;
  }
}
