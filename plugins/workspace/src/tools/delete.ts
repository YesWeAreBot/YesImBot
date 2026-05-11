import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { DeleteInput, ToolResult, WriteResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_delete";

const DESCRIPTION = `Delete a file or directory from the workspace.

Usage:
- Delete file: { path: "temp.txt" }
- Delete directory: { path: "build", recursive: true }

recursive is required for non-empty directories.`;

export function createDeleteTool(
  workspace: Workspace,
): ToolDefinition<DeleteInput, ToolResult<WriteResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path, recursive?",
    promptGuidelines: [
      "recursive: true is required for non-empty directories",
      "This operation cannot be undone",
    ],
    inputSchema: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("Path to delete"),
      recursive: z.boolean().optional().default(false).describe("Delete directories recursively"),
    }),
    execute: async (input) => {
      const { path, recursive = false } = input;
      const bash = workspace.bash;

      if (!path || path.trim().length === 0) {
        return createError("Path cannot be empty", "INVALID_PATH");
      }

      try {
        const cmd = recursive ? `rm -rf "${path}"` : `rm "${path}"`;
        const result = await bash.exec(cmd);

        if (result.exitCode !== 0) {
          const stderr = stripAnsi(result.stderr);
          if (stderr.includes("No such file") || stderr.includes("No such file or directory")) {
            return createError(`File not found: ${path}`, "FILE_NOT_FOUND");
          }
          if (stderr.includes("is a directory")) {
            return createError(
              `Is a directory: ${path}. Use recursive: true to delete directories.`,
              "IS_DIRECTORY",
            );
          }
          if (stderr.includes("Permission denied")) {
            return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
          }
          return createError(`Failed to delete: ${stderr}`, "DELETE_FAILED");
        }

        return {
          success: true,
          message: `Deleted: ${path}`,
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
