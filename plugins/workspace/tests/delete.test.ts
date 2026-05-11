import { describe, it, expect, vi, beforeEach } from "vitest";

import { createDeleteTool } from "../src/tools/delete";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_delete", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createDeleteTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes file successfully", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ path: "temp.txt" });
    expect(result).toEqual({ success: true, message: "Deleted: temp.txt" });
  });

  it("deletes directory recursively", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ path: "build", recursive: true });
    expect(result).toEqual({ success: true, message: "Deleted: build" });
  });

  it("returns error for empty path", async () => {
    const result = await tool.execute({ path: "" });
    expect(result).toEqual({ error: "Path cannot be empty", code: "INVALID_PATH" });
  });

  it("returns error for file not found", async () => {
    bash.exec.mockResolvedValue(execFail("rm: missing.txt: No such file or directory"));

    const result = await tool.execute({ path: "missing.txt" });
    expect(result).toEqual({ error: "File not found: missing.txt", code: "FILE_NOT_FOUND" });
  });

  it("returns error when deleting directory without recursive flag", async () => {
    bash.exec.mockResolvedValue(execFail("rm: mydir: is a directory"));

    const result = await tool.execute({ path: "mydir" });
    expect(result).toEqual({
      error: expect.stringContaining("recursive: true"),
      code: "IS_DIRECTORY",
    });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("rm: /root/file: Permission denied"));

    const result = await tool.execute({ path: "/root/file" });
    expect(result).toEqual({
      error: "Permission denied: /root/file",
      code: "PERMISSION_DENIED",
    });
  });
});
