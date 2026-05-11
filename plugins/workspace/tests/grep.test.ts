import { describe, it, expect, vi, beforeEach } from "vitest";

import { createGrepTool } from "../src/tools/grep";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_grep", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createGrepTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds matches", async () => {
    bash.exec.mockResolvedValue(execOk("file.ts:1:const x = 1;\nfile.ts:3:const y = 2;\n"));

    const result = await tool.execute({ pattern: "const" });
    expect(result).toMatchObject({
      matches: [
        { path: "file.ts", line: 1, content: "const x = 1;" },
        { path: "file.ts", line: 3, content: "const y = 2;" },
      ],
      totalMatches: 2,
      truncated: false,
    });
  });

  it("returns empty results when no matches", async () => {
    bash.exec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });

    const result = await tool.execute({ pattern: "nonexistent" });
    expect(result).toEqual({ matches: [], totalMatches: 0, truncated: false });
  });

  it("returns error for empty pattern", async () => {
    const result = await tool.execute({ pattern: "" });
    expect(result).toEqual({ error: "Pattern cannot be empty", code: "INVALID_PATTERN" });
  });

  it("returns error for invalid maxResults", async () => {
    const result = await tool.execute({ pattern: "test", maxResults: 0 });
    expect(result).toEqual({
      error: "maxResults must be a positive integer",
      code: "INVALID_MAX_RESULTS",
    });
  });

  it("returns error for invalid contextLines", async () => {
    const result = await tool.execute({ pattern: "test", contextLines: -1 });
    expect(result).toEqual({
      error: "contextLines must be non-negative",
      code: "INVALID_CONTEXT_LINES",
    });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("grep: /root: Permission denied", 2));

    const result = await tool.execute({ pattern: "test", path: "/root" });
    expect(result).toEqual({
      error: "Permission denied: /root",
      code: "PERMISSION_DENIED",
    });
  });

  it("searches case-insensitively when configured", async () => {
    bash.exec.mockResolvedValue(execOk("file.ts:1:ERROR found\n"));

    await tool.execute({ pattern: "error", caseSensitive: false });
    expect(bash.exec).toHaveBeenCalledWith(expect.stringContaining("grep -rni"));
  });

  it("includes context lines when configured", async () => {
    bash.exec.mockResolvedValue(execOk("file.ts-1-before\nfile.ts:2:match\nfile.ts-3-after\n"));

    await tool.execute({ pattern: "match", contextLines: 1 });
    expect(bash.exec).toHaveBeenCalledWith(expect.stringContaining("-C 1"));
  });
});
