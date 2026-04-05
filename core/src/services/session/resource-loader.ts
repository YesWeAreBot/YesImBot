import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { jsonSchema } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import type { Logger } from "koishi";

import type { ChannelRuntimeOptions } from "./runtime";
import { DEFAULT_SESSION_INSTRUCTIONS } from "./scaffold";
import type { LocalFilesystem } from "./workspace";
import {
  createWorkspaceBoundaryError,
  normalizeWorkspacePath,
  withinBasePath,
} from "./workspace/helpers";

interface SkillInput {
  name: string;
}

interface SkillReadInput {
  name: string;
  path: string;
}

interface SkillSearchInput {
  query: string;
  name?: string;
  topK?: number;
}

interface SkillRecord {
  name: string;
  rootPath: string;
  skillFile: string;
}

async function readSkillFile(skillPath: string): Promise<string> {
  return readFile(skillPath, "utf8");
}

function resolveSkillPath(options: {
  path: string;
  channelDir: string;
  filesystem?: LocalFilesystem;
}): string {
  if (options.filesystem) {
    return options.filesystem.resolvePath(options.path);
  }

  const workspaceRoot = resolve(options.channelDir, "workspace");
  const candidates = isAbsolute(options.path)
    ? [resolve(options.path), resolve(workspaceRoot, normalizeWorkspacePath(options.path))]
    : [resolve(workspaceRoot, normalizeWorkspacePath(options.path))];

  for (const candidatePath of candidates) {
    if (withinBasePath(candidatePath, workspaceRoot)) {
      return candidatePath;
    }
  }

  throw createWorkspaceBoundaryError(options.path);
}

async function collectSkills(options: {
  skills?: string[];
  channelDir: string;
  filesystem?: LocalFilesystem;
}): Promise<SkillRecord[]> {
  if (!options.skills || options.skills.length === 0) {
    return [];
  }

  const skillRoots = options.skills.map((skillPath) =>
    resolveSkillPath({
      path: skillPath,
      channelDir: options.channelDir,
      filesystem: options.filesystem,
    }),
  );
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
    } catch {}

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
      } catch {}
    }
  }

  return records;
}

async function resolveSkill(options: {
  skills?: string[];
  channelDir: string;
  filesystem?: LocalFilesystem;
  name: string;
}): Promise<SkillRecord> {
  const skills = await collectSkills({
    skills: options.skills,
    channelDir: options.channelDir,
    filesystem: options.filesystem,
  });
  const skill = skills.find(
    (item) => item.name === options.name || item.rootPath === resolve(options.name),
  );
  if (!skill) {
    throw new Error(`Skill not found: ${options.name}`);
  }
  return skill;
}

function buildSessionSkillTools(options: {
  settingsManager: ChannelRuntimeOptions["settingsManager"];
  channelDir: string;
  filesystem?: LocalFilesystem;
}): ToolSet {
  const configuredSkills = options.settingsManager.getWorkspaceSettings()?.skills;
  if (!configuredSkills || configuredSkills.length === 0) {
    return {};
  }

  return {
    skill: {
      description: "Load a skill by name.",
      inputSchema: jsonSchema<SkillInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      }),
      execute: async (input) => {
        const skill = await resolveSkill({
          skills: configuredSkills,
          channelDir: options.channelDir,
          filesystem: options.filesystem,
          name: input.name,
        });
        return {
          name: skill.name,
          content: await readSkillFile(skill.skillFile),
        };
      },
    },
    skill_read: {
      description: "Read a file under a skill directory.",
      inputSchema: jsonSchema<SkillReadInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          path: { type: "string" },
        },
        required: ["name", "path"],
      }),
      execute: async (input) => {
        const skill = await resolveSkill({
          skills: configuredSkills,
          channelDir: options.channelDir,
          filesystem: options.filesystem,
          name: input.name,
        });
        const relativePath = normalizeWorkspacePath(input.path);
        const targetPath = resolve(skill.rootPath, relativePath);
        if (!withinBasePath(targetPath, skill.rootPath)) {
          throw createWorkspaceBoundaryError(input.path);
        }

        return {
          name: skill.name,
          path: input.path,
          content: await readSkillFile(targetPath),
        };
      },
    },
    skill_search: {
      description: "Search text across loaded skills.",
      inputSchema: jsonSchema<SkillSearchInput>({
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          name: { type: "string" },
          topK: { type: "number" },
        },
        required: ["query"],
      }),
      execute: async (input) => ({
        matches: await (async () => {
          const skillRecords = await collectSkills({
            skills: configuredSkills,
            channelDir: options.channelDir,
            filesystem: options.filesystem,
          });
          const filteredSkills = input.name
            ? skillRecords.filter((skill) => skill.name === input.name)
            : skillRecords;
          const topK = input.topK ?? 5;
          const normalizedQuery = input.query.toLowerCase();
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
        })(),
      }),
    },
  };
}

export const DEFAULT_SESSION_PROMPT_RESOURCE_FILES = ["SOUL.md", "AGENTS.md", "PERSONA.md"];

export interface SessionPromptResource {
  source: string;
  path: string;
  content: string;
}

export interface LoadSessionPromptResourcesOptions {
  workspaceDir: string;
  filenames?: string[];
  logger: Logger;
  resourceTransform?: (resource: SessionPromptResource) => SessionPromptResource | null;
  resourcesOverride?: (base: SessionPromptResource[]) => SessionPromptResource[];
}

export interface SessionResourceLoader {
  getPromptResources(): { resources: SessionPromptResource[] };
  getSystemPrompt(): string | undefined;
  getAppendSystemPrompt(): string[];
  getSkillTools(filesystem?: LocalFilesystem): ToolSet;
  buildSystemPrompt(): string;
  reload(): void;
}

export interface DefaultSessionResourceLoaderOptions {
  channelDir: string;
  settingsManager: ChannelRuntimeOptions["settingsManager"];
  logger: Logger;
  promptResourceFilenames?: string[];
  promptResourceTransform?: (resource: SessionPromptResource) => SessionPromptResource | null;
  promptResourcesOverride?: (base: SessionPromptResource[]) => SessionPromptResource[];
  builtInInstructionsOverride?: (base: string) => string;
  systemPromptOverride?: (base: string | undefined) => string | undefined;
  appendSystemPromptOverride?: (base: string[]) => string[];
}

export interface BuildSessionSystemPromptOptions {
  channelDir: string;
  settingsManager: ChannelRuntimeOptions["settingsManager"];
  logger: Logger;
  builtInInstructionsOverride?: (base: string) => string;
  promptResourceFilenames?: string[];
  promptResourceTransform?: (resource: SessionPromptResource) => SessionPromptResource | null;
  promptResourcesOverride?: (base: SessionPromptResource[]) => SessionPromptResource[];
  systemPromptOverride?: (base: string | undefined) => string | undefined;
  appendSystemPromptOverride?: (base: string[]) => string[];
}

function normalizeResourceFilenames(filenames?: string[]): string[] {
  if (!filenames) {
    return [...DEFAULT_SESSION_PROMPT_RESOURCE_FILES];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const filename of filenames) {
    const trimmed = filename.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function loadSessionPromptResources(
  options: LoadSessionPromptResourcesOptions,
): SessionPromptResource[] {
  if (!existsSync(options.workspaceDir)) {
    mkdirSync(options.workspaceDir, { recursive: true });
  }

  const filenames = normalizeResourceFilenames(options.filenames);
  const resources: SessionPromptResource[] = [];

  for (const filename of filenames) {
    const filePath = join(options.workspaceDir, filename);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const content = readFileSync(filePath, "utf8").trim();
      if (!content) {
        continue;
      }

      const resource: SessionPromptResource = {
        source: filename,
        path: filePath,
        content,
      };

      if (!options.resourceTransform) {
        resources.push(resource);
        continue;
      }

      const transformed = options.resourceTransform(resource);
      if (transformed) {
        resources.push(transformed);
      }
    } catch {
      options.logger.warn(`Failed to read instructions from ${filePath}`);
    }
  }

  return options.resourcesOverride ? options.resourcesOverride(resources) : resources;
}

function toProjectContextSection(resource: SessionPromptResource): string | null {
  const content = resource.content.trim();
  if (!content) {
    return null;
  }

  return `### ${resource.source}\n${content}`;
}

export interface AssembleSessionSystemPromptInput {
  systemPrompt?: string;
  appendSystemPrompt?: string[];
}

export function assembleSessionSystemPrompt(input: AssembleSessionSystemPromptInput): string {
  const basePrompt = input.systemPrompt?.trim();
  const appendBlocks = (input.appendSystemPrompt ?? [])
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const sections: string[] = [];
  if (basePrompt) {
    sections.push(basePrompt);
  }
  sections.push(...appendBlocks);

  return sections.join("\n\n");
}

export function buildSessionSystemPrompt(options: BuildSessionSystemPromptOptions): string {
  const resourceLoader = new DefaultSessionResourceLoader({
    channelDir: options.channelDir,
    settingsManager: options.settingsManager,
    logger: options.logger,
    promptResourceFilenames: options.promptResourceFilenames,
    promptResourceTransform: options.promptResourceTransform,
    promptResourcesOverride: options.promptResourcesOverride,
    builtInInstructionsOverride: options.builtInInstructionsOverride,
    systemPromptOverride: options.systemPromptOverride,
    appendSystemPromptOverride: options.appendSystemPromptOverride,
  });
  resourceLoader.reload();
  return resourceLoader.buildSystemPrompt();
}

export class DefaultSessionResourceLoader implements SessionResourceLoader {
  private channelDir: string;
  private settingsManager: ChannelRuntimeOptions["settingsManager"];
  private logger: Logger;
  private promptResourceFilenames?: string[];
  private promptResourceTransform?: (
    resource: SessionPromptResource,
  ) => SessionPromptResource | null;
  private promptResourcesOverride?: (base: SessionPromptResource[]) => SessionPromptResource[];
  private builtInInstructionsOverride?: (base: string) => string;
  private systemPromptOverride?: (base: string | undefined) => string | undefined;
  private appendSystemPromptOverride?: (base: string[]) => string[];

  private resources: SessionPromptResource[] = [];
  private systemPrompt: string | undefined;
  private appendSystemPrompt: string[] = [];

  constructor(options: DefaultSessionResourceLoaderOptions) {
    this.channelDir = options.channelDir;
    this.settingsManager = options.settingsManager;
    this.logger = options.logger;
    this.promptResourceFilenames = options.promptResourceFilenames;
    this.promptResourceTransform = options.promptResourceTransform;
    this.promptResourcesOverride = options.promptResourcesOverride;
    this.builtInInstructionsOverride = options.builtInInstructionsOverride;
    this.systemPromptOverride = options.systemPromptOverride;
    this.appendSystemPromptOverride = options.appendSystemPromptOverride;
  }

  getPromptResources(): { resources: SessionPromptResource[] } {
    return { resources: this.resources };
  }

  getSystemPrompt(): string | undefined {
    return this.systemPrompt;
  }

  getAppendSystemPrompt(): string[] {
    return this.appendSystemPrompt;
  }

  getSkillTools(filesystem?: LocalFilesystem): ToolSet {
    return buildSessionSkillTools({
      settingsManager: this.settingsManager,
      channelDir: this.channelDir,
      filesystem,
    });
  }

  buildSystemPrompt(): string {
    return assembleSessionSystemPrompt({
      systemPrompt: this.systemPrompt,
      appendSystemPrompt: this.appendSystemPrompt,
    });
  }

  reload(): void {
    const workspaceDir = join(this.channelDir, "workspace");
    const configuredResourceFiles = this.settingsManager.getPromptResourceFilenames(
      DEFAULT_SESSION_PROMPT_RESOURCE_FILES,
    );
    const promptResourceFiles =
      this.promptResourceFilenames ??
      configuredResourceFiles ??
      DEFAULT_SESSION_PROMPT_RESOURCE_FILES;
    const resources = loadSessionPromptResources({
      workspaceDir,
      filenames: promptResourceFiles,
      logger: this.logger,
      resourceTransform: this.promptResourceTransform,
      resourcesOverride: this.promptResourcesOverride,
    });
    this.resources = resources;

    const resolvedBuiltIn =
      this.settingsManager.getBuiltInInstructions(DEFAULT_SESSION_INSTRUCTIONS) ??
      DEFAULT_SESSION_INSTRUCTIONS;
    const builtIn = this.builtInInstructionsOverride
      ? this.builtInInstructionsOverride(resolvedBuiltIn)
      : resolvedBuiltIn;
    this.systemPrompt = this.systemPromptOverride ? this.systemPromptOverride(builtIn) : builtIn;

    const projectContextSections = resources
      .map(toProjectContextSection)
      .filter((block): block is string => Boolean(block));
    const baseAppendSystemPrompt =
      projectContextSections.length > 0
        ? [`## Project Context\n\n${projectContextSections.join("\n\n")}`]
        : [];
    this.appendSystemPrompt = this.appendSystemPromptOverride
      ? this.appendSystemPromptOverride(baseAppendSystemPrompt)
      : baseAppendSystemPrompt;
  }
}
