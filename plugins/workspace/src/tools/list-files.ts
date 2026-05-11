import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { ListFilesInput, ListFilesResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, limitLines, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_list_files";

const DESCRIPTION = `List files and directories in the workspace. Returns a compact tree-format listing.

Usage:
- List current directory: { path: "." }
- List with depth: { path: "src", maxDepth: 3 }
- Show hidden files: { path: ".", showHidden: true }
- Filter by pattern: { path: ".", pattern: "**/*.ts" }`;

export function createListFilesTool(
  workspace: Workspace,
): ToolDefinition<ListFilesInput, ToolResult<ListFilesResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path?, maxDepth?, showHidden?, pattern?",
    promptGuidelines: [
      "Default path is current directory (.)",
      "Default maxDepth is 2",
      "Use pattern to filter by glob (e.g., **/*.ts)",
    ],
    inputSchema: z.object({
      path: z.string().optional().default(".").describe('Directory path (default: ".")'),
      maxDepth: z
        .number()
        .int()
        .positive()
        .optional()
        .default(2)
        .describe("Maximum depth (default: 2)"),
      showHidden: z.boolean().optional().default(false).describe("Show hidden files"),
      dirsOnly: z.boolean().optional().default(false).describe("List directories only"),
      pattern: z.string().optional().describe('Glob pattern (e.g., "**/*.ts")'),
    }),
    execute: async (input) => {
      const { path = ".", maxDepth = 2, showHidden = false, dirsOnly = false, pattern } = input;
      const bash = workspace.bash;

      if (maxDepth !== undefined && maxDepth < 1) {
        return createError("maxDepth must be a positive integer", "INVALID_MAX_DEPTH");
      }

      try {
        let cmd = `find "${path}" -maxdepth ${maxDepth}`;
        if (dirsOnly) cmd += " -type d";
        if (!showHidden) cmd += " -not -path '*/.*'";
        if (pattern) cmd += ` -name "${pattern}"`;
        cmd += " | sort";

        const result = await bash.exec(cmd);

        if (result.exitCode !== 0) {
          const stderr = stripAnsi(result.stderr);
          if (stderr.includes("No such file") || stderr.includes("No such file or directory")) {
            return createError(`Directory not found: ${path}`, "DIRECTORY_NOT_FOUND");
          }
          if (stderr.includes("Permission denied")) {
            return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
          }
          return createError(`Failed to list files: ${stderr}`, "LIST_FAILED");
        }

        const output = stripAnsi(result.stdout);
        const { content, truncated, totalLines } = limitLines(output, 500);

        return {
          tree: content,
          summary: `Listed ${totalLines} entries`,
          truncated,
        };
      } catch (error) {
        return createError(
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          "INTERNAL_ERROR",
        );
      }
    },
  };
}
