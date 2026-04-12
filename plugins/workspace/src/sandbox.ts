import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ExecuteCommandInput, LocalSandboxOptions } from "./types";

export class LocalSandbox {
  readonly workingDirectory: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;

  constructor(options: LocalSandboxOptions) {
    this.workingDirectory = resolve(options.workingDirectory);
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async init(): Promise<void> {
    await mkdir(this.workingDirectory, { recursive: true });
  }

  async executeCommand(input: ExecuteCommandInput): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
  }> {
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    return new Promise((resolveResult, rejectResult) => {
      const child = spawn(input.command, {
        cwd: this.workingDirectory,
        env: this.env,
        shell: true,
      });

      let stdout = "";
      let stderr = "";
      let finished = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        if (!finished) {
          timedOut = true;
          child.kill("SIGTERM");
        }
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.once("error", (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        rejectResult(error);
      });

      child.once("close", (exitCode) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolveResult({
          stdout,
          stderr,
          exitCode,
          timedOut,
        });
      });
    });
  }
}
