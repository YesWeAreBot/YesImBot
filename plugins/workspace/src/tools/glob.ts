import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { GlobInput, GlobResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_glob";

const DESCRIPTION = `Find files by glob pattern. Returns matching file paths sorted by modification time.

Usage:
- Find TypeScript files: { pattern: "**/*.ts" }
- Find in directory: { pattern: "*.json", path: "src" }
- Find test files: { pattern: "**/*.test.*" }`;

export function createGlobTool(
  workspace: Workspace,
): ToolDefinition<GlobInput, ToolResult<GlobResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "pattern, path?",
    promptGuidelines: [
      "Use ** for recursive matching",
      "Results sorted by modification time",
      "Returns relative paths",
    ],
    inputSchema: z.object({
      pattern: z
        .string()
        .min(1, "Pattern cannot be empty")
        .describe('Glob pattern (e.g., "**/*.ts")'),
      path: z.string().optional().default(".").describe('Search directory (default: ".")'),
    }),
    execute: async (input) => {
      const { pattern, path = "." } = input;
      const bash = workspace.bash;

      if (!pattern || pattern.trim().length === 0) {
        return createError("Pattern cannot be empty", "INVALID_PATTERN");
      }

      const maxResults = 100;

      try {
        const result = await bash.exec(
          `find "${path}" -name "${pattern}" -type f 2>/dev/null | sort | head -n ${maxResults + 1}`,
        );

        if (result.exitCode !== 0) {
          const stderr = stripAnsi(result.stderr);
          if (stderr.includes("No such file") || stderr.includes("No such file or directory")) {
            return createError(`Directory not found: ${path}`, "DIRECTORY_NOT_FOUND");
          }
          if (stderr.includes("Permission denied")) {
            return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
          }
          return createError(`Search failed: ${stderr}`, "GLOB_FAILED");
        }

        const output = stripAnsi(result.stdout);
        if (!output.trim()) {
          return { files: [], totalFiles: 0, truncated: false };
        }

        const allFiles = output.split("\n").filter(Boolean);
        const truncated = allFiles.length > maxResults;
        const files = allFiles.slice(0, maxResults);

        return {
          files,
          totalFiles: files.length,
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
