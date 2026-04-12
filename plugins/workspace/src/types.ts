import type { Tool as AiTool } from "@ai-sdk/provider-utils";
import type { Logger } from "koishi";

import type { LocalFilesystem } from "./filesystem";
import type { LocalSandbox } from "./sandbox";

export type FileType = "file" | "directory";

export interface PathTypeEntry {
  path: string;
  type: FileType;
}

export interface LocalFilesystemOptions {
  basePath: string;
  readOnly?: boolean;
  externalPath?: string | string[];
}

export interface LocalSandboxOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface WorkspaceOptions {
  filesystem?: LocalFilesystem;
  sandbox?: LocalSandbox;
}

export interface ReadFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface EditFileInput {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

export interface ListFilesInput {
  path?: string;
  recursive?: boolean;
  maxDepth?: number;
}

export interface DeleteInput {
  path: string;
  recursive?: boolean;
}

export interface FileStatInput {
  path: string;
}

export interface MkdirInput {
  path: string;
}

export interface GrepInput {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface ExecuteCommandInput {
  command: string;
  timeoutMs?: number;
}

export type WorkspaceToolSet = Record<string, AiTool>;

export interface WorkspacePluginConfig {
  mode?: "scoped" | "global";
  enableWorkspace?: boolean;
  enableSandbox?: boolean;
  enableFilesystem?: boolean;
  externalPath?: string[];
  skills?: string[];
}

export interface WorkspaceSettingsManager {
  getWorkspaceSettings(): WorkspacePluginConfig | undefined;
  getBuiltInInstructions?(fallback?: string): string | undefined;
  getPromptResourceFilenames?(fallback?: string[]): string[] | undefined;
}

export interface WorkspacePluginOptions {
  basePath: string;
  settingsManager?: WorkspaceSettingsManager;
  logger: Logger;
  createFilesystem?: (
    workspaceRoot: string,
    config: WorkspacePluginConfig,
  ) => LocalFilesystem | undefined;
  createSandbox?: (
    workspaceRoot: string,
    config: WorkspacePluginConfig,
  ) => LocalSandbox | undefined;
}
