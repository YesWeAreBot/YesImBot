import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import type { ExecuteCommandInput, ExecuteResult, ToolResult } from "../types";
import type { Workspace } from "../workspace";
import { createError, limitLines, stripAnsi } from "./helpers";

const TOOL_NAME = "execute_command";

const DESCRIPTION = `Execute a shell command in the sandboxed workspace environment.

Usage:
- Run command: { command: "ls -la" }
- With timeout: { command: "npm test", timeoutMs: 60000 }
- Pipes and redirects: { command: "cat file.txt | grep error" }

Commands run in a sandbox with isolated shell state. File system is shared across calls.`;

export function createExecuteCommandTool(
  workspace: Workspace,
): ToolDefinition<ExecuteCommandInput, ToolResult<ExecuteResult>> {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
      timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds"),
    }),
    execute: async (input) => {
      const { command, timeoutMs: inputTimeout } = input;
      const bash = workspace.bash;

      if (!command || command.trim().length === 0) {
        return createError("Command cannot be empty", "INVALID_COMMAND");
      }

      const timeoutMs = inputTimeout ?? workspace.defaultTimeoutMs;
      if (timeoutMs < 1) {
        return createError("timeoutMs must be a positive integer", "INVALID_TIMEOUT");
      }

      const startTime = Date.now();

      try {
        const result = await bash.exec(command, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        const durationMs = Date.now() - startTime;
        const stdout = stripAnsi(result.stdout);
        const stderr = stripAnsi(result.stderr);

        const { content: limitedStdout, truncated: stdoutTruncated } = limitLines(stdout, 200);
        const { content: limitedStderr } = limitLines(stderr, 50);

        return {
          stdout: limitedStdout,
          stderr: limitedStderr,
          exitCode: result.exitCode,
          timedOut: false,
          durationMs,
          truncated: stdoutTruncated,
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;

        if (error instanceof Error && error.name === "TimeoutError") {
          return {
            stdout: "",
            stderr: `Command timed out after ${timeoutMs}ms`,
            exitCode: null,
            timedOut: true,
            durationMs,
          };
        }

        return createError(error instanceof Error ? error.message : String(error), "EXEC_FAILED");
      }
    },
  };
}
