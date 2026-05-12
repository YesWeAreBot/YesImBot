import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { GrepInput, GrepResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, stripAnsi } from "./helpers";

const TOOL_NAME = "grep";

const DESCRIPTION = `Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.

Usage:
- Basic search: { pattern: "TODO" }
- Regex: { pattern: "function\\s+\\w+\\(" }
- Case-insensitive: { pattern: "error", caseSensitive: false }
- Search in directory: { pattern: "import", path: "./src" }`;

export function createGrepTool(
  workspace: Workspace,
): ToolDefinition<GrepInput, ToolResult<GrepResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    inputSchema: z.object({
      pattern: z.string().min(1, "Pattern cannot be empty").describe("Regex pattern to search for"),
      path: z.string().optional().default(".").describe('Search path (default: ".")'),
      caseSensitive: z.boolean().optional().default(true).describe("Case-sensitive search"),
      contextLines: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .default(0)
        .describe("Context lines around match"),
      maxResults: z.number().int().positive().optional().default(50).describe("Maximum results"),
    }),
    execute: async (input) => {
      const {
        pattern,
        path = ".",
        caseSensitive = true,
        contextLines = 0,
        maxResults = 50,
      } = input;
      const bash = workspace.bash;

      if (!pattern || pattern.trim().length === 0) {
        return createError("Pattern cannot be empty", "INVALID_PATTERN");
      }
      if (maxResults < 1) {
        return createError("maxResults must be a positive integer", "INVALID_MAX_RESULTS");
      }
      if (contextLines < 0) {
        return createError("contextLines must be non-negative", "INVALID_CONTEXT_LINES");
      }

      try {
        let cmd = `grep -rn`;
        if (!caseSensitive) cmd += "i";
        if (contextLines > 0) cmd += ` -C ${contextLines}`;
        cmd += ` --include="*" "${pattern}" "${path}" 2>/dev/null | head -n ${maxResults}`;

        const result = await bash.exec(cmd);

        if (result.exitCode !== 0 && result.exitCode !== 1) {
          const stderr = stripAnsi(result.stderr);
          if (stderr.includes("Permission denied")) {
            return createError(`Permission denied: ${path}`, "PERMISSION_DENIED");
          }
          return createError(`Search failed: ${stderr}`, "GREP_FAILED");
        }

        const output = stripAnsi(result.stdout);
        if (!output.trim()) {
          return { matches: [], totalMatches: 0, truncated: false };
        }

        const lines = output.split("\n");
        const matches = lines
          .map((line) => {
            const match = line.match(/^(.+?):(\d+):(.*)$/);
            if (match) {
              return {
                path: match[1],
                line: Number.parseInt(match[2], 10),
                content: match[3],
              };
            }
            return null;
          })
          .filter((m): m is { path: string; line: number; content: string } => m !== null);

        return {
          matches,
          totalMatches: matches.length,
          truncated: matches.length >= maxResults,
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
