import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { ReadFileInput, ReadFileResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, formatLine, limitLines, stripAnsi } from "./helpers";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;

const TOOL_NAME = "read_file";

const DESCRIPTION = `Read the contents of a file. Use offset/limit for large files. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). When you need the full file, continue with offset until complete.`;

export function createReadFileTool(
  workspace: Workspace,
): ToolDefinition<ReadFileInput, ToolResult<ReadFileResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "Read file contents",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],
    inputSchema: z.object({
      path: z.string().describe("Path to the file to read (relative or absolute)"),
      offset: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Line number to start reading from (1-indexed)"),
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

      const { content, truncated } = limitLines(formattedLines.join("\n"), DEFAULT_MAX_LINES);

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
