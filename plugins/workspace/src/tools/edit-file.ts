import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { EditFileInput, ToolResult, WriteResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "workspace_edit_file";

const DESCRIPTION = `Edit a file by replacing specific text. The old_string must match exactly and be unique in the file.

Usage:
- Single replacement: { path: "file.ts", old_string: "const x = 1", new_string: "const x = 2" }
- Replace all: { path: "file.ts", old_string: "foo", new_string: "bar", replace_all: true }

The old_string must be unique in the file unless replace_all is true.`;

export function createEditFileTool(
  workspace: Workspace,
): ToolDefinition<EditFileInput, ToolResult<WriteResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "path, old_string, new_string, replace_all?",
    promptGuidelines: [
      "old_string must be unique in the file unless replace_all is true",
      "Preserve exact indentation from the file content",
      "Prefer editing existing files; use write_file only for new files",
    ],
    inputSchema: z
      .object({
        path: z.string().min(1, "Path cannot be empty").describe("File path"),
        old_string: z
          .string()
          .min(1, "old_string cannot be empty")
          .describe("Exact text to replace (must be unique)"),
        new_string: z.string().describe("Replacement text"),
        replace_all: z.boolean().optional().default(false).describe("Replace all occurrences"),
      })
      .transform(
        (val): EditFileInput => ({
          path: val.path,
          oldText: val.old_string,
          newText: val.new_string,
          replaceAll: val.replace_all,
        }),
      ),
    execute: async (input) => {
      const { path, oldText, newText, replaceAll = false } = input;
      const bash = workspace.bash;

      if (!path || path.trim().length === 0) {
        return createError("Path cannot be empty", "INVALID_PATH");
      }
      if (!oldText || oldText.length === 0) {
        return createError("oldText cannot be empty", "INVALID_OLD_TEXT");
      }

      try {
        const readResult = await bash.exec(`cat "${path}"`);
        if (readResult.exitCode !== 0) {
          const stderr = stripAnsi(readResult.stderr);
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

        const content = stripAnsi(readResult.stdout);

        const occurrences = content.split(oldText).length - 1;
        if (occurrences === 0) {
          return createError(
            `String not found in file: "${oldText.substring(0, 50)}${oldText.length > 50 ? "..." : ""}"`,
            "STRING_NOT_FOUND",
          );
        }

        if (!replaceAll && occurrences > 1) {
          return createError(
            `String is not unique (${occurrences} occurrences). Use replaceAll: true or provide more context.`,
            "NOT_UNIQUE",
          );
        }

        const newContent = replaceAll
          ? content.split(oldText).join(newText)
          : content.replace(oldText, newText);

        const writeResult = await bash.exec(
          `cat > "${path}" << 'WORKSPACE_EOF'\n${newContent}\nWORKSPACE_EOF`,
        );

        if (writeResult.exitCode !== 0) {
          return createError(
            `Failed to write file: ${stripAnsi(writeResult.stderr)}`,
            "WRITE_FAILED",
          );
        }

        return {
          success: true,
          message: `File edited successfully: ${path} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`,
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
