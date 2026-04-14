import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize, resolve, sep } from "node:path";

export interface SkillRecord {
  name: string;
  rootPath: string;
  skillFile: string;
}

export interface SkillSummary {
  name: string;
  location: string;
  description: string;
}

const SKILL_ROOT_BOUNDARY_ERROR = "is outside configured skill root";

export function resolveSkillRoots(baseDir: string, configuredRoots: readonly string[]): string[] {
  const deduped = new Set<string>();
  for (const configuredRoot of configuredRoots) {
    const trimmed = configuredRoot.trim();
    if (!trimmed) {
      continue;
    }

    const resolvedRoot = isAbsolute(trimmed)
      ? resolve(trimmed)
      : resolve(baseDir, normalizeSkillRelativePath(trimmed));
    deduped.add(resolvedRoot);
  }
  return [...deduped];
}

export async function collectSkills(skillRoots: readonly string[]): Promise<SkillRecord[]> {
  const records: SkillRecord[] = [];

  for (const rootPath of skillRoots) {
    const rootStat = await getPathStat(rootPath);
    if (!rootStat) {
      continue;
    }

    if (rootStat.isFile() && basename(rootPath) === "SKILL.md") {
      records.push({
        name: basename(dirname(rootPath)),
        rootPath: dirname(rootPath),
        skillFile: rootPath,
      });
      continue;
    }

    const directSkillFile = resolve(rootPath, "SKILL.md");
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
      // no-op: continue to child scan
    }

    const children = await readdir(rootPath, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }

      const skillRoot = resolve(rootPath, child.name);
      const skillFile = resolve(skillRoot, "SKILL.md");
      try {
        const skillFileStat = await stat(skillFile);
        if (!skillFileStat.isFile()) {
          continue;
        }

        records.push({
          name: child.name,
          rootPath: skillRoot,
          skillFile,
        });
      } catch {
        // no-op: ignore directories without SKILL.md
      }
    }
  }

  return records;
}

export async function buildSkillSummaries(skillRoots: readonly string[]): Promise<SkillSummary[]> {
  const skills = await collectSkills(skillRoots);
  const summaries: SkillSummary[] = [];

  for (const skill of skills) {
    try {
      const content = await readSkillFileSafely(skill);
      summaries.push({
        name: skill.name,
        location: skill.rootPath,
        description: extractSkillDescription(content),
      });
    } catch {
      // ignore unsafe or unreadable skill files when building summaries
    }
  }

  return summaries.sort((left, right) => left.name.localeCompare(right.name));
}

export async function resolveSkillReadPath(
  skillRoot: string,
  relativePath: string,
): Promise<string> {
  const normalizedRelativePath = normalizeSkillReadPath(relativePath);
  const targetPath = resolve(skillRoot, normalizedRelativePath);
  if (!withinBasePath(targetPath, skillRoot)) {
    throw createSkillBoundaryError(relativePath);
  }

  return await resolveCanonicalPathWithinRoot(skillRoot, targetPath, relativePath);
}

export async function readSkillFileSafely(skill: SkillRecord): Promise<string> {
  const canonicalSkillFile = await resolveCanonicalPathWithinRoot(
    skill.rootPath,
    skill.skillFile,
    skill.skillFile,
  );
  return await readFile(canonicalSkillFile, "utf8");
}

async function resolveCanonicalPathWithinRoot(
  rootPath: string,
  targetPath: string,
  displayPath: string,
): Promise<string> {
  const [canonicalRootPath, canonicalTargetPath] = await Promise.all([
    realpath(rootPath),
    realpath(targetPath),
  ]);
  if (!withinBasePath(canonicalTargetPath, canonicalRootPath)) {
    throw createSkillBoundaryError(displayPath);
  }

  return canonicalTargetPath;
}

async function getPathStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function normalizeSkillRelativePath(path: string): string {
  const normalized = normalize(path.replace(/\\/g, "/"));
  return normalized.replace(/^\/+/, "");
}

function normalizeSkillReadPath(path: string): string {
  const normalized = normalize(path.replace(/\\/g, "/"));
  if (isAbsolute(path) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw createSkillBoundaryError(path);
  }

  return normalized.replace(/^\/+/, "");
}

function withinBasePath(targetPath: string, basePath: string): boolean {
  if (targetPath === basePath) {
    return true;
  }

  const rootedBasePath = basePath.endsWith(sep) ? basePath : `${basePath}${sep}`;
  return targetPath.startsWith(rootedBasePath);
}

function createSkillBoundaryError(path: string): Error {
  return new Error(`Path '${path}' ${SKILL_ROOT_BOUNDARY_ERROR}`);
}

function extractSkillDescription(content: string): string {
  const lines = content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    return line.length > 140 ? `${line.slice(0, 140)}...` : line;
  }

  return "No summary provided.";
}
