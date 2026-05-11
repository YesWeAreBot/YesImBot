import type { ToolDefinition } from "@yesimbot/agent/session";
import type { NetworkConfig as BashNetworkConfig } from "just-bash";

// ============================================================================
// 配置类型
// ============================================================================

export interface WorkspaceConfig {
  /** 工作区根目录（宿主机路径） */
  root: string;

  /** 文件系统配置 */
  filesystem?: {
    /** 持久化路径映射：虚拟路径 → 宿主机路径 */
    persistPaths?: Record<string, string>;
    /** 初始文件（注入到虚拟文件系统） */
    initialFiles?: Record<string, string>;
  };

  /** Bash 配置 */
  bash?: {
    /** 默认工作目录（虚拟路径，默认: /home/user） */
    cwd?: string;
    /** 默认环境变量 */
    env?: Record<string, string>;
    /** 默认超时（毫秒，默认: 30000） */
    timeoutMs?: number;
    /** 执行限制 */
    executionLimits?: ExecutionLimits;
    /** 网络配置（默认禁用） */
    network?: NetworkConfig;
    /** 启用 Python（默认: false） */
    python?: boolean;
    /** 启用 JavaScript（默认: false） */
    javascript?: boolean;
  };
}

export interface ExecutionLimits {
  maxCallDepth?: number;
  maxCommandCount?: number;
  maxLoopIterations?: number;
  maxAwkIterations?: number;
  maxSedIterations?: number;
}

type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";

export interface NetworkConfig extends BashNetworkConfig {
  allowedUrlPrefixes?: Array<
    string | { url: string; transform?: Array<{ headers: Record<string, string> }> }
  >;
  allowedMethods?: HttpMethod[];
  dangerouslyAllowFullInternetAccess?: boolean;
}

// ============================================================================
// 工具输入类型
// ============================================================================

export interface ReadFileInput {
  path: string;
  offset?: number;
  limit?: number;
  showLineNumbers?: boolean;
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
  maxDepth?: number;
  showHidden?: boolean;
  dirsOnly?: boolean;
  exclude?: string;
  extension?: string;
  pattern?: string | string[];
}

export interface DeleteInput {
  path: string;
  recursive?: boolean;
}

export interface MkdirInput {
  path: string;
  recursive?: boolean;
}

export interface FileStatInput {
  path: string;
}

export interface GrepInput {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  contextLines?: number;
  maxResults?: number;
}

export interface GlobInput {
  pattern: string;
  path?: string;
}

export interface ExecuteCommandInput {
  command: string;
  timeoutMs?: number;
}

// ============================================================================
// 工具输出类型
// ============================================================================

/** 错误结果 */
export interface ErrorResult {
  error: string;
  code?: string;
  details?: unknown;
}

/** 成功结果基础类型 */
export interface SuccessResult {
  success: true;
}

export interface ReadFileResult {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  warning?: string;
}

export interface WriteResult extends SuccessResult {
  message: string;
}

export interface ListFilesResult {
  tree: string;
  summary: string;
  truncated?: boolean;
}

export interface FileStatResult {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
  permissions: string;
}

export interface GrepResult {
  matches: Array<{ path: string; line: number; content: string }>;
  totalMatches: number;
  truncated: boolean;
}

export interface GlobResult {
  files: string[];
  totalFiles: number;
  truncated: boolean;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  truncated?: boolean;
  workingDirectory?: string;
}

/** 工具结果联合类型 */
export type ToolResult<T> = T | ErrorResult;

// ============================================================================
// 工具集合类型
// ============================================================================

export interface WorkspaceToolDefinitions {
  read_file: ToolDefinition<ReadFileInput, ToolResult<ReadFileResult>>;
  write_file: ToolDefinition<WriteFileInput, ToolResult<WriteResult>>;
  edit_file: ToolDefinition<EditFileInput, ToolResult<WriteResult>>;
  list_files: ToolDefinition<ListFilesInput, ToolResult<ListFilesResult>>;
  delete: ToolDefinition<DeleteInput, ToolResult<WriteResult>>;
  mkdir: ToolDefinition<MkdirInput, ToolResult<WriteResult>>;
  file_stat: ToolDefinition<FileStatInput, ToolResult<FileStatResult>>;
  grep: ToolDefinition<GrepInput, ToolResult<GrepResult>>;
  glob: ToolDefinition<GlobInput, ToolResult<GlobResult>>;
  execute_command: ToolDefinition<ExecuteCommandInput, ToolResult<ExecuteResult>>;
}

export type WorkspaceToolSet = WorkspaceToolDefinitions[keyof WorkspaceToolDefinitions][];
