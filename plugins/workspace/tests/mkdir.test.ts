import { describe, it, expect, vi, beforeEach } from "vitest";

import { createMkdirTool } from "../src/tools/mkdir";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_mkdir", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createMkdirTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates directory successfully", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ path: "src/utils" });
    expect(result).toEqual({ success: true, message: "Directory created: src/utils" });
  });

  it("creates directory with parents by default", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    await tool.execute({ path: "a/b/c" });
    expect(bash.exec).toHaveBeenCalledWith(expect.stringContaining("mkdir -p"));
  });

  it("creates directory without parents when recursive is false", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    await tool.execute({ path: "mydir", recursive: false });
    expect(bash.exec).toHaveBeenCalledWith(expect.stringContaining('mkdir "mydir"'));
  });

  it("returns error for empty path", async () => {
    const result = await tool.execute({ path: "" });
    expect(result).toEqual({ error: "Path cannot be empty", code: "INVALID_PATH" });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(
      execFail("mkdir: cannot create directory '/root/test': Permission denied"),
    );

    const result = await tool.execute({ path: "/root/test" });
    expect(result).toEqual({
      error: "Permission denied: /root/test",
      code: "PERMISSION_DENIED",
    });
  });

  it("returns error when parent does not exist without recursive", async () => {
    bash.exec.mockResolvedValue(
      execFail("mkdir: cannot create directory 'a/b': No such file or directory"),
    );

    const result = await tool.execute({ path: "a/b", recursive: false });
    expect(result).toEqual({
      error: expect.stringContaining("Parent directory does not exist"),
      code: "PARENT_NOT_FOUND",
    });
  });

  it("returns error when path exists as file", async () => {
    bash.exec.mockResolvedValue(execFail("mkdir: cannot create directory 'file.txt': File exists"));

    const result = await tool.execute({ path: "file.txt" });
    expect(result).toEqual({
      error: expect.stringContaining("already exists"),
      code: "EXISTS",
    });
  });
});
