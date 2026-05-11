import { describe, it, expect, vi, beforeEach } from "vitest";

import { createListFilesTool } from "../src/tools/list-files";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_list_files", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createListFilesTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists files in directory", async () => {
    bash.exec.mockResolvedValue(execOk("src\nsrc/index.ts\nsrc/utils"));

    const result = await tool.execute({ path: "." });
    expect(result).toMatchObject({
      tree: expect.stringContaining("src"),
      summary: expect.stringContaining("3 entries"),
    });
  });

  it("lists files with custom depth", async () => {
    bash.exec.mockResolvedValue(execOk("src"));

    const result = await tool.execute({ path: "src", maxDepth: 1 });
    expect(result).toMatchObject({ tree: expect.stringContaining("src") });
  });

  it("returns error for invalid maxDepth", async () => {
    const result = await tool.execute({ path: ".", maxDepth: 0 });
    expect(result).toEqual({
      error: "maxDepth must be a positive integer",
      code: "INVALID_MAX_DEPTH",
    });
  });

  it("returns error for directory not found", async () => {
    bash.exec.mockResolvedValue(execFail("find: 'missing': No such file or directory"));

    const result = await tool.execute({ path: "missing" });
    expect(result).toEqual({
      error: "Directory not found: missing",
      code: "DIRECTORY_NOT_FOUND",
    });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("find: '/root': Permission denied"));

    const result = await tool.execute({ path: "/root" });
    expect(result).toEqual({
      error: "Permission denied: /root",
      code: "PERMISSION_DENIED",
    });
  });

  it("lists hidden files when showHidden is true", async () => {
    bash.exec.mockResolvedValue(execOk(".gitignore\nsrc"));

    const result = await tool.execute({ path: ".", showHidden: true });
    expect(result).toMatchObject({ tree: expect.stringContaining(".gitignore") });
  });

  it("lists directories only when dirsOnly is true", async () => {
    bash.exec.mockResolvedValue(execOk("src"));

    const result = await tool.execute({ path: ".", dirsOnly: true });
    expect(result).toMatchObject({ tree: expect.stringContaining("src") });
  });
});
