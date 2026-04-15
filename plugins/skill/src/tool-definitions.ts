import { readFile } from "node:fs/promises";

import { jsonSchema, tool } from "@ai-sdk/provider-utils";
import type { RegisteredToolDefinition } from "@yesimbot/plugin-sdk";

import {
  collectSkills,
  readSkillFileSafely,
  resolveSkillReadPath,
  resolveSkillRoots,
} from "./state";

interface SkillToolInput {
  name: string;
}

interface SkillReadToolInput {
  name: string;
  path: string;
}

interface SkillSearchToolInput {
  query: string;
  name?: string;
  topK?: number;
}

interface BuildSkillPluginToolDefinitionsOptions {
  baseDir: string;
  skills: string[];
}

export async function buildSkillPluginToolDefinitions(
  options: BuildSkillPluginToolDefinitionsOptions,
): Promise<RegisteredToolDefinition[]> {
  const getSkills = async () => {
    const roots = resolveSkillRoots(options.baseDir, options.skills);
    return await collectSkills(roots);
  };

  const executeSkillTool = async (input: SkillToolInput) => {
    const skill = await resolveSkillByName(getSkills, input.name);
    return {
      name: skill.name,
      content: await readSkillFileSafely(skill),
    };
  };

  const skillTool = tool({
    description: "Load a skill by name.",
    inputSchema: jsonSchema<SkillToolInput>({
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    }),
    execute: executeSkillTool,
  });

  const executeSkillReadTool = async (input: SkillReadToolInput) => {
    const skill = await resolveSkillByName(getSkills, input.name);
    const targetPath = await resolveSkillReadPath(skill.rootPath, input.path);
    return {
      name: skill.name,
      path: input.path,
      content: await readFile(targetPath, "utf8"),
    };
  };

  const skillReadTool = tool({
    description: "Read a file under a skill directory.",
    inputSchema: jsonSchema<SkillReadToolInput>({
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        path: { type: "string" },
      },
      required: ["name", "path"],
    }),
    execute: executeSkillReadTool,
  });

  const executeSkillSearchTool = async (input: SkillSearchToolInput) => {
    const allSkills = await getSkills();
    const skillPool = input.name
      ? allSkills.filter((skill) => skill.name === input.name)
      : allSkills;
    const topK = input.topK ?? 5;
    const normalizedQuery = input.query.toLowerCase();

    const matches: Array<{ name: string; path: string; content: string }> = [];
    for (const skill of skillPool) {
      let content: string;
      try {
        content = await readSkillFileSafely(skill);
      } catch {
        continue;
      }
      if (!content.toLowerCase().includes(normalizedQuery)) {
        continue;
      }

      matches.push({
        name: skill.name,
        path: skill.skillFile,
        content,
      });

      if (matches.length >= topK) {
        break;
      }
    }

    return { matches };
  };

  const skillSearchTool = tool({
    description: "Search text across loaded skills.",
    inputSchema: jsonSchema<SkillSearchToolInput>({
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        name: { type: "string" },
        topK: { type: "number" },
      },
      required: ["query"],
    }),
    execute: executeSkillSearchTool,
  });

  return [
    {
      pluginName: "skill",
      name: "skill",
      definition: {
        name: "skill",
        description: skillTool.description ?? "Load a skill by name.",
        inputSchema: skillTool.inputSchema,
        execute: async (input, _options) => await executeSkillTool(input as SkillToolInput),
      },
      tool: skillTool,
    },
    {
      pluginName: "skill",
      name: "skill_read",
      definition: {
        name: "skill_read",
        description: skillReadTool.description ?? "Read a file under a skill directory.",
        inputSchema: skillReadTool.inputSchema,
        execute: async (input, _options) => await executeSkillReadTool(input as SkillReadToolInput),
      },
      tool: skillReadTool,
    },
    {
      pluginName: "skill",
      name: "skill_search",
      definition: {
        name: "skill_search",
        description: skillSearchTool.description ?? "Search text across loaded skills.",
        inputSchema: skillSearchTool.inputSchema,
        execute: async (input, _options) =>
          await executeSkillSearchTool(input as SkillSearchToolInput),
      },
      tool: skillSearchTool,
    },
  ];
}

async function resolveSkillByName(
  getSkills: () => Promise<Array<{ name: string; rootPath: string; skillFile: string }>>,
  name: string,
): Promise<{ name: string; rootPath: string; skillFile: string }> {
  const skills = await getSkills();
  const skill = skills.find((item) => item.name === name);
  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }

  return skill;
}
