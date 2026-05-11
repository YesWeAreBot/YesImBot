import { describe, it, expect, vi, beforeEach } from "vitest";

import { createEditFileTool } from "../src/tools/edit-file";
import type { EditFileInput } from "../src/types";
import { createMockWorkspace, execOk, execFail } from "./helpers";

describe("workspace_edit_file", () => {
  const { workspace, bash } = createMockWorkspace();
  const tool = createEditFileTool(workspace);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces unique string", async () => {
    bash.exec.mockResolvedValueOnce(execOk("const x = 1;\n"));
    bash.exec.mockResolvedValueOnce(execOk(""));

    const result = await tool.execute({
      path: "file.ts",
      oldText: "const x = 1",
      newText: "const x = 2",
    });
    expect(result).toEqual({
      success: true,
      message: expect.stringContaining("1 replacement"),
    });
  });

  it("replaces all occurrences", async () => {
    bash.exec.mockResolvedValueOnce(execOk("foo bar foo baz foo\n"));
    bash.exec.mockResolvedValueOnce(execOk(""));

    const result = await tool.execute({
      path: "file.txt",
      oldText: "foo",
      newText: "qux",
      replaceAll: true,
    });
    expect(result).toEqual({
      success: true,
      message: expect.stringContaining("3 replacements"),
    });
  });

  it("returns error for empty path", async () => {
    const result = await tool.execute({
      path: "",
      oldText: "a",
      newText: "b",
    });
    expect(result).toEqual({ error: "Path cannot be empty", code: "INVALID_PATH" });
  });

  it("returns error for empty oldText", async () => {
    const result = await tool.execute({
      path: "file.txt",
      oldText: "",
      newText: "b",
    });
    expect(result).toEqual({ error: "oldText cannot be empty", code: "INVALID_OLD_TEXT" });
  });

  it("returns error for file not found", async () => {
    bash.exec.mockResolvedValue(execFail("cat: missing.txt: No such file or directory"));

    const result = await tool.execute({
      path: "missing.txt",
      oldText: "a",
      newText: "b",
    });
    expect(result).toEqual({ error: "File not found: missing.txt", code: "FILE_NOT_FOUND" });
  });

  it("returns error for permission denied", async () => {
    bash.exec.mockResolvedValue(execFail("cat: secret.txt: Permission denied"));

    const result = await tool.execute({
      path: "secret.txt",
      oldText: "a",
      newText: "b",
    });
    expect(result).toEqual({ error: "Permission denied: secret.txt", code: "PERMISSION_DENIED" });
  });

  it("returns error for directory", async () => {
    bash.exec.mockResolvedValue(execFail("cat: mydir: Is a directory"));

    const result = await tool.execute({
      path: "mydir",
      oldText: "a",
      newText: "b",
    });
    expect(result).toEqual({ error: "Is a directory: mydir", code: "IS_DIRECTORY" });
  });

  it("returns error when string not found", async () => {
    bash.exec.mockResolvedValue(execOk("some content\n"));

    const result = await tool.execute({
      path: "file.txt",
      oldText: "nonexistent",
      newText: "replacement",
    });
    expect(result).toEqual({
      error: expect.stringContaining("String not found"),
      code: "STRING_NOT_FOUND",
    });
  });

  it("returns error for non-unique string without replaceAll", async () => {
    bash.exec.mockResolvedValue(execOk("foo bar foo\n"));

    const result = await tool.execute({
      path: "file.txt",
      oldText: "foo",
      newText: "qux",
    });
    expect(result).toEqual({
      error: expect.stringContaining("not unique"),
      code: "NOT_UNIQUE",
    });
  });
});
