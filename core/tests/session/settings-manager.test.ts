import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SettingsManager } from "../../src/services/session/settings-manager";

interface TestPaths {
  rootDir: string;
  globalSettingsPath: string;
  workspaceSettingsPath: string;
}

function createTestPaths(prefix: string): TestPaths {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  return {
    rootDir,
    globalSettingsPath: join(rootDir, "settings.json"),
    workspaceSettingsPath: join(rootDir, "workspace.settings.json"),
  };
}

describe("SettingsManager", () => {
  it("falls back to global settings when workspace settings are absent", async () => {
    const paths = createTestPaths("athena-settings-global-fallback-");
    try {
      writeFileSync(paths.globalSettingsPath, JSON.stringify({ model: "global-model" }), "utf8");

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({ model: "global-model" });
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("recursively merges nested objects", async () => {
    const paths = createTestPaths("athena-settings-nested-merge-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({
          judge: {
            enabled: true,
            timeoutMs: 10000,
          },
        }),
        "utf8",
      );

      writeFileSync(
        paths.workspaceSettingsPath,
        JSON.stringify({
          judge: {
            timeoutMs: 3000,
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({
        judge: {
          enabled: true,
          timeoutMs: 3000,
        },
      });
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("replaces arrays instead of concatenating", async () => {
    const paths = createTestPaths("athena-settings-array-replace-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({
          workspace: {
            externalPath: ["/global-a", "/global-b"],
          },
        }),
        "utf8",
      );

      writeFileSync(
        paths.workspaceSettingsPath,
        JSON.stringify({
          workspace: {
            externalPath: ["/local-only"],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({
        workspace: {
          externalPath: ["/local-only"],
        },
      });
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("supports configurable prompt resource filenames via prompts.attachedInstructionFiles", async () => {
    const paths = createTestPaths("athena-settings-prompt-files-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({
          prompts: {
            attachedInstructionFiles: ["SOUL.md", "AGENTS.md"],
          },
        }),
        "utf8",
      );

      writeFileSync(
        paths.workspaceSettingsPath,
        JSON.stringify({
          prompts: {
            attachedInstructionFiles: ["PERSONA.md"],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({
        prompts: {
          attachedInstructionFiles: ["PERSONA.md"],
        },
      });
      expect(manager.getPromptResourceFilenames(["DEFAULT.md"])).toEqual(["PERSONA.md"]);
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores deprecated useGlobal and still layers workspace over global", async () => {
    const paths = createTestPaths("athena-settings-use-global-false-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({
          model: "global-model",
          judge: { enabled: true },
        }),
        "utf8",
      );

      writeFileSync(
        paths.workspaceSettingsPath,
        JSON.stringify({
          useGlobal: false,
          model: "workspace-model",
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({
        model: "workspace-model",
        judge: {
          enabled: true,
        },
      });
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "deprecated-key",
            path: "useGlobal",
            scope: "workspace",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("strips useGlobal from resolved settings", async () => {
    const paths = createTestPaths("athena-settings-strip-use-global-");
    try {
      writeFileSync(paths.globalSettingsPath, JSON.stringify({ model: "global-model" }), "utf8");
      writeFileSync(
        paths.workspaceSettingsPath,
        JSON.stringify({ useGlobal: true, model: "workspace-model" }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({ model: "workspace-model" });
      expect("useGlobal" in manager.resolveSettings()).toBe(false);
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores malformed settings files", async () => {
    const paths = createTestPaths("athena-settings-malformed-");
    try {
      writeFileSync(paths.globalSettingsPath, "{invalid", "utf8");
      writeFileSync(paths.workspaceSettingsPath, "{broken", "utf8");

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({});
      expect(manager.getReloadMetadata().issues).toHaveLength(2);
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("records conflicts when manual overrides differ from Koishi defaults", async () => {
    const paths = createTestPaths("athena-settings-conflicts-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({ model: "global-model", response: { maxSteps: 9 } }),
        "utf8",
      );
      writeFileSync(
        paths.workspaceSettingsPath,
        JSON.stringify({ response: { maxSteps: 5 } }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        workspaceSettingsPath: paths.workspaceSettingsPath,
        defaults: {
          model: "fallback-model",
          response: { maxSteps: 3 },
        },
      });

      expect(manager.getReloadMetadata().conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scope: "global",
            path: "model",
          }),
          expect.objectContaining({
            scope: "global",
            path: "response.maxSteps",
          }),
          expect.objectContaining({
            scope: "workspace",
            path: "response.maxSteps",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });
});
