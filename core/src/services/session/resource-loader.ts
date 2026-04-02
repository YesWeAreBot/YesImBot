import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "koishi";

import type { ChannelAgentOptions } from "./channel-agent";
import { DEFAULT_SESSION_INSTRUCTIONS } from "./scaffold";

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
  buildSystemPrompt(): string;
  reload(): void;
}

export interface DefaultSessionResourceLoaderOptions {
  channelDir: string;
  settingsManager: ChannelAgentOptions["settingsManager"];
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
  settingsManager: ChannelAgentOptions["settingsManager"];
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
  private settingsManager: ChannelAgentOptions["settingsManager"];
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
