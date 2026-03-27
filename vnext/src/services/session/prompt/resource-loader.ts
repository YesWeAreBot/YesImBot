import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createExtensionRuntime,
  type PathMetadata,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";

import { ROLE_FILES, type ResourceLoaderConfig } from "./resource-types";

const CORE_SYSTEM_PROMPT = [
  "You are Athena, a Koishi-based AI assistant running in channel sessions.",
  "Stay aligned with configured role files and provide concise, practical responses.",
].join(" ");

const ROLE_OPEN_TAGS = {
  character: "<character>",
  agents: "<agents>",
  tools: "<tools>",
  memory: "<memory>",
} as const;

const ROLE_CLOSE_TAGS = {
  character: "</character>",
  agents: "</agents>",
  tools: "</tools>",
  memory: "</memory>",
} as const;

type ResourceExtensionPaths = Parameters<ResourceLoader["extendResources"]>[0];

export class AthenaResourceLoader implements ResourceLoader {
  private readonly soulDir: string;

  constructor(config: ResourceLoaderConfig) {
    this.soulDir = config.soulDir;
  }

  getExtensions() {
    return {
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    };
  }

  getSkills() {
    return {
      skills: [],
      diagnostics: [],
    };
  }

  getPrompts() {
    return {
      prompts: [],
      diagnostics: [],
    };
  }

  getThemes() {
    return {
      themes: [],
      diagnostics: [],
    };
  }

  getAgentsFiles() {
    return {
      agentsFiles: [],
    };
  }

  getSystemPrompt(): string {
    return CORE_SYSTEM_PROMPT;
  }

  getAppendSystemPrompt(): string[] {
    const prompts: string[] = [];

    for (const spec of ROLE_FILES) {
      const filePath = join(this.soulDir, spec.filename);
      if (!existsSync(filePath)) {
        continue;
      }

      const content = readFileSync(filePath, "utf-8");
      const openTag = ROLE_OPEN_TAGS[spec.tag];
      const closeTag = ROLE_CLOSE_TAGS[spec.tag];
      prompts.push(`${openTag}\n${content}\n${closeTag}`);
    }

    return prompts;
  }

  getPathMetadata(): Map<string, PathMetadata> {
    return new Map();
  }

  extendResources(paths: ResourceExtensionPaths) {}

  async reload(): Promise<void> {}
}
