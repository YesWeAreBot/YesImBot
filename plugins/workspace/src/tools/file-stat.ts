import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { FileStatInput, FileStatResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_file_stat";

const DESCRIPTION = `Get file or directory metadata. Returns existence, type, size, and modification time.

Usage:
- Get file info: { path: "src/index.ts" }
- Get directory info: { path: "src" }`;

export function createFileStatTool(
  workspace: Workspace,
): ToolDefinition<FileStatInput, ToolResult<FileStatResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path",
    promptGuidelines: [
      "Returns file type, size, and modification time",
      "Works for both files and directories",
    ],
    inputSchema: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("Path to check"),
    }),
    execute: async (input) => {
      const { path } = input;
      const bash = workspace.bash;

      if (!path || path.trim().length === 0) {
        return createError("Path cannot be empty", "INVALID_PATH");
      }

      try {
        const result = await bash.exec(
          `stat -c '%F|%s|%y|%a' "${path}" 2>/dev/null || echo "NOT_FOUND"`,
        );

        const output = stripAnsi(result.stdout).trim();
        if (output === "NOT_FOUND" || result.exitCode !== 0) {
          return createError(`File not found: ${path}`, "FILE_NOT_FOUND");
        }

        const parts = output.split("|");
        if (parts.length < 4) {
          return createError(`Failed to parse stat output for: ${path}`, "PARSE_ERROR");
        }

        const [rawType, rawSize, rawModified, rawPermissions] = parts;

        let type: FileStatResult["type"] = "other";
        if (rawType.includes("regular file")) type = "file";
        else if (rawType.includes("directory")) type = "directory";
        else if (rawType.includes("symbolic link")) type = "symlink";

        return {
          path,
          type,
          size: Number.parseInt(rawSize, 10) || 0,
          modifiedAt: rawModified?.trim() ?? "",
          permissions: rawPermissions?.trim() ?? "",
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
