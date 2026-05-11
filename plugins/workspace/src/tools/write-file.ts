import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { ToolResult, WriteFileInput, WriteResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_write_file";

const DESCRIPTION = `Write content to a file in the workspace. Creates the file if it doesn't exist, overwrites if it does.

Usage:
- Write file: { path: "src/new-file.ts", content: "console.log('hello')" }
- Create directory structure: { path: "deep/nested/file.txt", content: "data" }

Parent directories are created automatically.`;

export function createWriteFileTool(
  workspace: Workspace,
): ToolDefinition<WriteFileInput, ToolResult<WriteResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path, content",
    promptGuidelines: [
      "Overwrites existing files completely",
      "Creates parent directories automatically",
      "Use edit_file for partial modifications",
    ],
    inputSchema: z.object({
      path: z
        .string()
        .min(1, "Path cannot be empty")
        .describe('File path relative to workspace root (e.g., "src/new-file.ts")'),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async (input) => {
      const { path, content } = input;
      const bash = workspace.bash;

      if (!path || path.trim().length === 0) {
        return createError("Path cannot be empty", "INVALID_PATH");
      }

      try {
        const result = await bash.exec(
          `cat > "${path}" << 'WORKSPACE_EOF'\n${content}\nWORKSPACE_EOF`,
        );

        if (result.exitCode !== 0) {
          const stderr = stripAnsi(result.stderr);
          if (stderr.includes("Permission denied")) {
            return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
          }
          return createError(`Failed to write file: ${stderr}`, "WRITE_FAILED");
        }

        return {
          success: true,
          message: `File written successfully: ${path}`,
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
