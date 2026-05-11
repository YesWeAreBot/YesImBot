import { describe, it, expect, vi, beforeEach } from "vitest";

import { createExecuteCommandTool } from "../src/tools/execute-command";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_execute_command", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createExecuteCommandTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes command successfully", async () => {
    bash.exec.mockResolvedValue(execOk("hello\n"));

    const result = await tool.execute({ command: "echo hello" });
    expect(result).toMatchObject({
      stdout: expect.stringContaining("hello"),
      exitCode: 0,
      timedOut: false,
    });
  });

  it("returns error for empty command", async () => {
    const result = await tool.execute({ command: "" });
    expect(result).toEqual({ error: "Command cannot be empty", code: "INVALID_COMMAND" });
  });

  it("returns stderr on command failure", async () => {
    bash.exec.mockResolvedValue(execFail("command not found: badcmd", 127));

    const result = await tool.execute({ command: "badcmd" });
    expect(result).toMatchObject({
      exitCode: 127,
      timedOut: false,
    });
  });

  it("handles command timeout", async () => {
    bash.exec.mockRejectedValue(Object.assign(new Error("Timeout"), { name: "TimeoutError" }));

    const result = await tool.execute({ command: "sleep 100", timeoutMs: 1000 });
    expect(result).toMatchObject({
      timedOut: true,
      exitCode: null,
    });
  });

  it("includes duration in result", async () => {
    bash.exec.mockResolvedValue(execOk("done\n"));

    const result = await tool.execute({ command: "echo done" });
    expect(result).toMatchObject({
      durationMs: expect.any(Number),
    });
  });

  it("uses custom timeout when provided", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    await tool.execute({ command: "test", timeoutMs: 5000 });
    expect(bash.exec).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
