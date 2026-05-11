import { describe, it, expect, vi, beforeEach } from "vitest";

import { createFileStatTool } from "../src/tools/file-stat";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_file_stat", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createFileStatTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file metadata", async () => {
    bash.exec.mockResolvedValue(
      execOk("regular file|1024|2024-01-15 10:30:00.000000000 +0000|644"),
    );

    const result = await tool.execute({ path: "test.txt" });
    expect(result).toMatchObject({
      path: "test.txt",
      type: "file",
      size: 1024,
      permissions: "644",
    });
  });

  it("returns directory metadata", async () => {
    bash.exec.mockResolvedValue(execOk("directory|4096|2024-01-15 10:30:00.000000000 +0000|755"));

    const result = await tool.execute({ path: "src" });
    expect(result).toMatchObject({
      path: "src",
      type: "directory",
      size: 4096,
      permissions: "755",
    });
  });

  it("returns symlink metadata", async () => {
    bash.exec.mockResolvedValue(execOk("symbolic link|11|2024-01-15 10:30:00.000000000 +0000|777"));

    const result = await tool.execute({ path: "link" });
    expect(result).toMatchObject({
      path: "link",
      type: "symlink",
    });
  });

  it("returns error for empty path", async () => {
    const result = await tool.execute({ path: "" });
    expect(result).toEqual({ error: "Path cannot be empty", code: "INVALID_PATH" });
  });

  it("returns error for file not found", async () => {
    bash.exec.mockResolvedValue(execOk("NOT_FOUND"));

    const result = await tool.execute({ path: "missing.txt" });
    expect(result).toEqual({ error: "File not found: missing.txt", code: "FILE_NOT_FOUND" });
  });

  it("returns error for failed stat command", async () => {
    bash.exec.mockResolvedValue(execFail("stat: cannot stat"));

    const result = await tool.execute({ path: "bad.txt" });
    expect(result).toEqual({ error: "File not found: bad.txt", code: "FILE_NOT_FOUND" });
  });

  it("returns error for unparseable stat output", async () => {
    bash.exec.mockResolvedValue(execOk("unparseable output"));

    const result = await tool.execute({ path: "test.txt" });
    expect(result).toEqual({
      error: expect.stringContaining("Failed to parse stat output"),
      code: "PARSE_ERROR",
    });
  });
});
