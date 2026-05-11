import { describe, it, expect, vi, beforeEach } from "vitest";

import { createGlobTool } from "../src/tools/glob";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_glob", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createGlobTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds files by pattern", async () => {
    bash.exec.mockResolvedValue(execOk("src/index.ts\nsrc/utils.ts\n"));

    const result = await tool.execute({ pattern: "*.ts" });
    expect(result).toMatchObject({
      files: ["src/index.ts", "src/utils.ts"],
      totalFiles: 2,
      truncated: false,
    });
  });

  it("returns empty results when no matches", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ pattern: "*.nonexistent" });
    expect(result).toEqual({ files: [], totalFiles: 0, truncated: false });
  });

  it("returns error for empty pattern", async () => {
    const result = await tool.execute({ pattern: "" });
    expect(result).toEqual({ error: "Pattern cannot be empty", code: "INVALID_PATTERN" });
  });

  it("returns error for directory not found", async () => {
    bash.exec.mockResolvedValue(execFail("find: 'missing': No such file or directory"));

    const result = await tool.execute({ pattern: "*.ts", path: "missing" });
    expect(result).toEqual({
      error: "Directory not found: missing",
      code: "DIRECTORY_NOT_FOUND",
    });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("find: '/root': Permission denied"));

    const result = await tool.execute({ pattern: "*.ts", path: "/root" });
    expect(result).toEqual({
      error: "Permission denied: /root",
      code: "PERMISSION_DENIED",
    });
  });

  it("truncates results when over limit", async () => {
    const files = Array.from({ length: 101 }, (_, i) => `file${i}.ts`).join("\n");
    bash.exec.mockResolvedValue(execOk(files));

    const result = await tool.execute({ pattern: "*.ts" });
    expect(result).toMatchObject({
      truncated: true,
      totalFiles: 100,
    });
  });
});
