import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { MkdirInput, ToolResult, WriteResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_mkdir";

const DESCRIPTION = `Create a directory in the workspace. Creates parent directories if needed.

Usage:
- Create directory: { path: "src/utils" }
- Create with parents: { path: "a/b/c", recursive: true }`;

export function createMkdirTool(
  workspace: Workspace,
): ToolDefinition<MkdirInput, ToolResult<WriteResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path, recursive?",
    promptGuidelines: [
      "Creates parent directories by default",
      "No error if directory already exists",
    ],
    inputSchema: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("Directory path to create"),
      recursive: z.boolean().optional().default(true).describe("Create parent directories"),
    }),
    execute: async (input) => {
      const { path, recursive = true } = input;
      const bash = workspace.bash;

      if (!path || path.trim().length === 0) {
        return createError("Path cannot be empty", "INVALID_PATH");
      }

      try {
        const cmd = recursive ? `mkdir -p "${path}"` : `mkdir "${path}"`;
        const result = await bash.exec(cmd);

        if (result.exitCode !== 0) {
          const stderr = stripAnsi(result.stderr);
          if (stderr.includes("Permission denied")) {
            return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
          }
          if (stderr.includes("No such file") || stderr.includes("No such file or directory")) {
            return createError(
              `Parent directory does not exist: ${path}. Use recursive: true to create parent directories.`,
              "PARENT_NOT_FOUND",
            );
          }
          if (stderr.includes("File exists")) {
            return createError(`Path already exists and is not a directory: ${path}`, "EXISTS");
          }
          return createError(`Failed to create directory: ${stderr}`, "MKDIR_FAILED");
        }

        return {
          success: true,
          message: `Directory created: ${path}`,
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
