import type { Tool as AiTool } from "@ai-sdk/provider-utils";

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
