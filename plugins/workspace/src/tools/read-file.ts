import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { ReadFileInput, ReadFileResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, formatLine, limitLines, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_read_file";

const DESCRIPTION = `Read file contents from workspace. Supports line range selection for large files.

Usage:
- Read entire file: { path: "src/index.ts" }
- Read specific lines: { path: "src/index.ts", offset: 10, limit: 20 }
- Disable line numbers: { path: "config.json", showLineNumbers: false }

Default format includes line numbers (cat -n style). Use offset/limit for large files.`;

export function createReadFileTool(
  workspace: Workspace,
): ToolDefinition<ReadFileInput, ToolResult<ReadFileResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path, offset?, limit?, showLineNumbers?",
    promptGuidelines: [
      "Use offset/limit to read specific line ranges for large files",
      "Default format includes line numbers (cat -n style)",
      "Paths are relative to workspace root (/home/user)",
    ],
    inputSchema: z.object({
      path: z
        .string()
        .min(1, "Path cannot be empty")
        .describe('File path relative to workspace root (e.g., "src/index.ts")'),
      offset: z.number().int().positive().optional().describe("Start line number (1-indexed)"),
      limit: z.number().int().positive().optional().describe("Maximum number of lines to read"),
      showLineNumbers: z
        .boolean()
        .optional()
        .default(true)
        .describe("Show line numbers (default: true)"),
    }),
    execute: async (input) => {
      const { path, offset, limit, showLineNumbers = true } = input;
      const bash = workspace.bash;

      // 边界条件：检查路径是否为空
      if (!path || path.trim().length === 0) {
        return createError("Path cannot be empty", "INVALID_PATH");
      }

      // 边界条件：检查 offset 和 limit 的有效性
      if (offset !== undefined && offset < 1) {
        return createError("offset must be a positive integer", "INVALID_OFFSET");
      }
      if (limit !== undefined && limit < 1) {
        return createError("limit must be a positive integer", "INVALID_LIMIT");
      }

      const result = await bash.exec(`cat "${path}"`);

      if (result.exitCode !== 0) {
        const stderr = stripAnsi(result.stderr);
        if (stderr.includes("No such file") || stderr.includes("No such file or directory")) {
          return createError(`File not found: ${path}`, "FILE_NOT_FOUND");
        }
        if (stderr.includes("Permission denied")) {
          return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
        }
        if (stderr.includes("Is a directory")) {
          return createError(`Is a directory: ${path}`, "IS_DIRECTORY");
        }
        return createError(`Failed to read file: ${stderr}`, "READ_FAILED");
      }

      const rawContent = stripAnsi(result.stdout);
      const allLines = rawContent.split("\n");
      const totalLines = allLines.length;

      // 边界条件：文件为空
      if (totalLines === 0 || (totalLines === 1 && allLines[0] === "")) {
        return {
          content: "",
          totalLines: 0,
          startLine: 1,
          endLine: 0,
          warning: "File is empty",
        };
      }

      const startLine = offset ?? 1;

      // 边界条件：offset 超出文件长度
      if (startLine > totalLines) {
        return {
          content: "",
          totalLines,
          startLine,
          endLine: startLine - 1,
          warning: `offset (${startLine}) exceeds file length (${totalLines} lines)`,
        };
      }

      const endLine = limit ? Math.min(startLine + limit - 1, totalLines) : totalLines;
      const selectedLines = allLines.slice(startLine - 1, endLine);

      const formattedLines = selectedLines.map((line, i) =>
        formatLine(line, startLine + i, showLineNumbers),
      );

      const { content, truncated } = limitLines(formattedLines.join("\n"), 2000);

      const resultData: ReadFileResult = {
        content,
        totalLines,
        startLine,
        endLine: Math.min(endLine, startLine + formattedLines.length - 1),
      };

      if (truncated) {
        return {
          ...resultData,
          warning: `Output truncated. Use offset/limit to read specific sections.`,
        };
      }

      return resultData;
    },
  };
}
