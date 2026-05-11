import { ErrorResult } from "../types";
import type { Workspace } from "../workspace";

/**
 * 限制输出长度（按行数）
 */
export function limitLines(
  output: string,
  maxLines: number,
): { content: string; truncated: boolean; totalLines: number } {
  const lines = output.split("\n");
  const totalLines = lines.length;
  if (lines.length <= maxLines) {
    return { content: output, truncated: false, totalLines };
  }
  const truncated = lines.slice(0, maxLines).join("\n");
  return {
    content: `${truncated}\n\n... (truncated, showing ${maxLines} of ${totalLines} lines)`,
    truncated: true,
    totalLines,
  };
}

/**
 * 剥离 ANSI 转义码
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * 格式化行号
 */
export function formatLine(content: string, lineNumber: number, showLineNumbers: boolean): string {
  if (!showLineNumbers) return content;
  return `${String(lineNumber).padStart(6)}→ ${content}`;
}

/**
 * 获取 Workspace 实例（从工具上下文中）
 */
export function requireWorkspace(context: unknown): Workspace {
  const workspace = (context as { workspace?: Workspace })?.workspace;
  if (!workspace) {
    throw new Error("Workspace not available in tool context");
  }
  return workspace;
}

export function createError(message: string, code?: string): ErrorResult {
  return { error: message, code };
}
