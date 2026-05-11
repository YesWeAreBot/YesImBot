import { describe, it, expect, vi, beforeEach } from "vitest";

import { createReadFileTool } from "../src/tools/read-file";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_read_file", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createReadFileTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads file with line numbers", async () => {
    bash.exec.mockResolvedValue(execOk("hello\nworld"));

    const result = await tool.execute({ path: "test.txt" });
    expect(result).toMatchObject({
      content: expect.stringContaining("hello"),
      totalLines: 2,
      startLine: 1,
      endLine: 2,
    });
  });

  it("reads file without line numbers", async () => {
    bash.exec.mockResolvedValue(execOk("hello\nworld"));

    const result = await tool.execute({ path: "test.txt", showLineNumbers: false });
    expect(result).toMatchObject({
      content: expect.stringContaining("hello"),
    });
    expect(result.content).not.toContain("→");
  });

  it("reads specific line range with offset and limit", async () => {
    bash.exec.mockResolvedValue(execOk("line1\nline2\nline3\nline4\nline5"));

    const result = await tool.execute({ path: "test.txt", offset: 2, limit: 2 });
    expect(result).toMatchObject({
      startLine: 2,
      endLine: 3,
    });
  });

  it("returns error for empty path", async () => {
    const result = await tool.execute({ path: "" });
    expect(result).toEqual({ error: "Path cannot be empty", code: "INVALID_PATH" });
  });

  it("returns error for file not found", async () => {
    bash.exec.mockResolvedValue(execFail("cat: missing.txt: No such file or directory"));

    const result = await tool.execute({ path: "missing.txt" });
    expect(result).toEqual({ error: "File not found: missing.txt", code: "FILE_NOT_FOUND" });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("cat: secret.txt: Permission denied"));

    const result = await tool.execute({ path: "secret.txt" });
    expect(result).toEqual({ error: "Permission denied: secret.txt", code: "PERMISSION_DENIED" });
  });

  it("returns error for directory", async () => {
    bash.exec.mockResolvedValue(execFail("cat: mydir: Is a directory"));

    const result = await tool.execute({ path: "mydir" });
    expect(result).toEqual({ error: "Is a directory: mydir", code: "IS_DIRECTORY" });
  });

  it("returns error for invalid offset", async () => {
    const result = await tool.execute({ path: "test.txt", offset: 0 });
    expect(result).toEqual({ error: "offset must be a positive integer", code: "INVALID_OFFSET" });
  });

  it("returns error for invalid limit", async () => {
    const result = await tool.execute({ path: "test.txt", limit: -1 });
    expect(result).toEqual({ error: "limit must be a positive integer", code: "INVALID_LIMIT" });
  });

  it("handles empty file", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ path: "empty.txt" });
    expect(result).toMatchObject({
      content: "",
      totalLines: 0,
      warning: "File is empty",
    });
  });

  it("handles offset exceeding file length", async () => {
    bash.exec.mockResolvedValue(execOk("line1"));

    const result = await tool.execute({ path: "test.txt", offset: 100 });
    expect(result).toMatchObject({
      content: "",
      warning: expect.stringContaining("exceeds file length"),
    });
  });
});
