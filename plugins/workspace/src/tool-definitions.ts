import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import type { RegisteredToolDefinition } from "@yesimbot/plugin-sdk";
import { jsonSchema } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import type { Logger } from "koishi";

import { LocalFilesystem } from "./filesystem";
import {
  createWorkspaceBoundaryError,
  normalizeWorkspacePath,
  withinBasePath,
} from "./helpers";
import { LocalSandbox } from "./sandbox";
import type { WorkspacePluginConfig } from "./types";
import { Workspace } from "./workspace";

interface WorkspaceToolOptions {
  channelDir: string;
  logger: Logger;
  config: WorkspacePluginConfig;
  createFilesystem?: (
    workspaceRoot: string,
    config: WorkspacePluginConfig,
  ) => LocalFilesystem | undefined;
  createSandbox?: (
    workspaceRoot: string,
    config: WorkspacePluginConfig,
  ) => LocalSandbox | undefined;
}

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

export async function buildWorkspacePluginToolDefinitions(
  options: WorkspaceToolOptions,
): Promise<RegisteredToolDefinition[]> {
  if (options.config.enableWorkspace === false) {
    return [];
  }

  const workspaceRoot = join(options.channelDir, "workspace");
  const filesystem = options.config.enableFilesystem === false
    ? undefined
    : (options.createFilesystem?.(workspaceRoot, options.config) ??
      new LocalFilesystem({
        basePath: workspaceRoot,
        externalPath: options.config.externalPath,
      }));

  const sandbox = options.config.enableSandbox
    ? (options.createSandbox?.(workspaceRoot, options.config) ??
      new LocalSandbox({
        workingDirectory: workspaceRoot,
        env: process.env,
      }))
    : undefined;

  const workspace = new Workspace({ filesystem, sandbox });
  await workspace.init();

  const toolSet: ToolSet = {
    ...(workspace.getAgentTools() as ToolSet),
    ...(await buildSkillTools({
      channelDir: options.channelDir,
      config: options.config,
      filesystem,
    })),
  };

  return toRegisteredToolDefinitions("workspace", toolSet);
}

async function buildSkillTools(options: {
  channelDir: string;
  config: WorkspacePluginConfig;
  filesystem?: LocalFilesystem;
}): Promise<ToolSet> {
  if (!options.config.skills || options.config.skills.length === 0) {
    return {};
  }

  return {
    skill: {
      description: "Load a skill by name.",
      inputSchema: jsonSchema<SkillInput>({
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: async (input) => {
        const skill = await resolveSkill({
          skills: options.config.skills,
          channelDir: options.channelDir,
          filesystem: options.filesystem,
          name: input.name,
        });
        return {
          name: skill.name,
          content: await readFile(skill.skillFile, "utf8"),
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
          skills: options.config.skills,
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
          content: await readFile(targetPath, "utf8"),
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
        matches: await searchSkills({
          skills: options.config.skills,
          channelDir: options.channelDir,
          filesystem: options.filesystem,
          query: input.query,
          name: input.name,
          topK: input.topK,
        }),
      }),
    },
  };
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
  skills: string[];
  channelDir: string;
  filesystem?: LocalFilesystem;
}): Promise<SkillRecord[]> {
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
  skills: string[];
  channelDir: string;
  filesystem?: LocalFilesystem;
  name: string;
}): Promise<SkillRecord> {
  const skills = await collectSkills(options);
  const skill = skills.find((item) => item.name === options.name || item.rootPath === resolve(options.name));
  if (!skill) {
    throw new Error(`Skill not found: ${options.name}`);
  }
  return skill;
}

async function searchSkills(options: {
  skills: string[];
  channelDir: string;
  filesystem?: LocalFilesystem;
  query: string;
  name?: string;
  topK?: number;
}): Promise<Array<{ name: string; path: string; content: string }>> {
  const skillRecords = await collectSkills(options);
  const filteredSkills = options.name
    ? skillRecords.filter((skill) => skill.name === options.name)
    : skillRecords;
  const topK = options.topK ?? 5;
  const normalizedQuery = options.query.toLowerCase();
  const matches: Array<{ name: string; path: string; content: string }> = [];

  for (const skill of filteredSkills) {
    const content = await readFile(skill.skillFile, "utf8");
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

function toRegisteredToolDefinitions(
  pluginName: string,
  toolSet: ToolSet,
): RegisteredToolDefinition[] {
  return Object.entries(toolSet).map(([name, tool]) => ({
    pluginName,
    name,
    definition: {
      name,
      description: tool.description ?? `${pluginName}:${name}`,
      inputSchema: tool.inputSchema,
      isSupported: () => true,
      isAllowed: ({ enabledTools }: { enabledTools: string[] }) => enabledTools.includes(name),
      execute: async (input: unknown, executionOptions: Parameters<NonNullable<typeof tool.execute>>[1]) => {
        if (!tool.execute) {
          throw new Error(`Tool is not executable: ${name}`);
        }

        return await tool.execute(input, executionOptions);
      },
    },
    tool,
  }));
}
