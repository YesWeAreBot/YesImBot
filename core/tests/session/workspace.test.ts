import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalFilesystem, LocalSandbox, Workspace } from "../../src/services/session/workspace";

function createToolOptions() {
  return {
    toolCallId: "test-call-id",
    messages: [],
  };
}

describe("workspace", () => {
  it("exposes filesystem tools by default and hides sandbox/skill tools", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-fs-"));
    try {
      const workspace = new Workspace({
        filesystem: new LocalFilesystem({ basePath }),
      });

      const tools = workspace.getAgentTools();
      expect(tools).toHaveProperty("read_file");
      expect(tools).toHaveProperty("write_file");
      expect(tools).toHaveProperty("edit_file");
      expect(tools).toHaveProperty("list_files");
      expect(tools).toHaveProperty("delete");
      expect(tools).toHaveProperty("file_stat");
      expect(tools).toHaveProperty("mkdir");
      expect(tools).toHaveProperty("grep");
      expect(tools).not.toHaveProperty("execute_command");
      expect(tools).not.toHaveProperty("skill");
      expect(tools).not.toHaveProperty("skill_read");
      expect(tools).not.toHaveProperty("skill_search");
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("hides write tools when filesystem is read-only", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-ro-"));
    try {
      const workspace = new Workspace({
        filesystem: new LocalFilesystem({ basePath, readOnly: true }),
      });

      const tools = workspace.getAgentTools();
      expect(tools).toHaveProperty("read_file");
      expect(tools).toHaveProperty("list_files");
      expect(tools).toHaveProperty("file_stat");
      expect(tools).toHaveProperty("grep");
      expect(tools).not.toHaveProperty("write_file");
      expect(tools).not.toHaveProperty("edit_file");
      expect(tools).not.toHaveProperty("delete");
      expect(tools).not.toHaveProperty("mkdir");
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("exposes execute command only when sandbox is configured", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-sandbox-"));
    try {
      const workspace = new Workspace({
        filesystem: new LocalFilesystem({ basePath }),
        sandbox: new LocalSandbox({ workingDirectory: basePath }),
      });

      const tools = workspace.getAgentTools();
      expect(tools).toHaveProperty("execute_command");

      const execute = tools.execute_command.execute;
      const result = await execute?.(
        {
          command: "node -e \"process.stdout.write('ok')\"",
        },
        createToolOptions(),
      );

      expect(result).toMatchObject({
        stdout: "ok",
        exitCode: 0,
        timedOut: false,
      });
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("exposes skill tools only when skills are configured", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-skills-"));
    try {
      const skillsRoot = join(basePath, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      const skillFile = join(skillRoot, "SKILL.md");
      const referenceFile = join(skillRoot, "references", "guide.md");
      mkdirSync(join(skillRoot, "references"), { recursive: true });
      writeFileSync(skillFile, "# Code Review\nAlways review carefully.", { encoding: "utf8" });
      writeFileSync(referenceFile, "Use references for checks.", { encoding: "utf8" });

      const workspace = new Workspace({
        filesystem: new LocalFilesystem({ basePath }),
        skills: ["/skills"],
      });

      const tools = workspace.getAgentTools();
      expect(tools).toHaveProperty("skill");
      expect(tools).toHaveProperty("skill_read");
      expect(tools).toHaveProperty("skill_search");

      const skillResult = await tools.skill.execute?.({ name: "code-review" }, createToolOptions());
      expect(skillResult).toMatchObject({
        name: "code-review",
      });

      const readResult = await tools.skill_read.execute?.(
        { name: "code-review", path: "references/guide.md" },
        createToolOptions(),
      );
      expect(readResult).toMatchObject({
        content: "Use references for checks.",
      });

      const searchResult = await tools.skill_search.execute?.(
        { query: "review" },
        createToolOptions(),
      );
      expect(searchResult).toMatchObject({
        matches: [
          {
            name: "code-review",
          },
        ],
      });
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
