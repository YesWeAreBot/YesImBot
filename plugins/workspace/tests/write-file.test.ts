import { describe, it, expect, vi, beforeEach } from "vitest";

import { createWriteFileTool } from "../src/tools/write-file";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_write_file", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createWriteFileTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes file successfully", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ path: "output.txt", content: "hello" });
    expect(result).toEqual({ success: true, message: "File written successfully: output.txt" });
  });

  it("returns error for empty path", async () => {
    const result = await tool.execute({ path: "", content: "hello" });
    expect(result).toEqual({ error: "Path cannot be empty", code: "INVALID_PATH" });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("Permission denied"));

    const result = await tool.execute({ path: "/root/secret", content: "data" });
    expect(result).toEqual({ error: "Permission denied: /root/secret", code: "PERMISSION_DENIED" });
  });

  it("handles empty content", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const result = await tool.execute({ path: "empty.txt", content: "" });
    expect(result).toEqual({ success: true, message: "File written successfully: empty.txt" });
  });

  it("handles multiline content", async () => {
    bash.exec.mockResolvedValue(execOk(""));

    const content = "line1\nline2\nline3";
    const result = await tool.execute({ path: "multi.txt", content });
    expect(result).toEqual({ success: true, message: "File written successfully: multi.txt" });
  });
});
