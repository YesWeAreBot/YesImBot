import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SettingsManager } from "../../src/services/session/settings-manager";

interface TestPaths {
  rootDir: string;
  globalSettingsPath: string;
  channelSettingsPath: string;
}

function createTestPaths(prefix: string): TestPaths {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  return {
    rootDir,
    globalSettingsPath: join(rootDir, "settings.json"),
    channelSettingsPath: join(rootDir, "channel.settings.json"),
  };
}

describe("SettingsManager", () => {
  it("falls back to global settings when channel settings are absent", async () => {
    const paths = createTestPaths("athena-settings-global-fallback-");
    try {
      writeFileSync(paths.globalSettingsPath, JSON.stringify({ model: "global-model" }), "utf8");

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
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
        paths.channelSettingsPath,
        JSON.stringify({
          judge: {
            timeoutMs: 3000,
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
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

  it("ignores extracted channel array overrides", async () => {
    const paths = createTestPaths("athena-settings-ignore-channel-array-");
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
        paths.channelSettingsPath,
        JSON.stringify({
          workspace: {
            externalPath: ["/local-only"],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({});
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "workspace",
            scope: "global",
          }),
          expect.objectContaining({
            code: "unknown-key",
            path: "workspace",
            scope: "channel",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores legacy prompts.attachedInstructionFiles and keeps builtInInstructions", async () => {
    const paths = createTestPaths("athena-settings-prompt-files-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({
          prompts: {
            builtInInstructions: "global instructions",
            attachedInstructionFiles: ["SOUL.md", "AGENTS.md"],
          },
        }),
        "utf8",
      );

      writeFileSync(
        paths.channelSettingsPath,
        JSON.stringify({
          prompts: {
            builtInInstructions: "channel instructions",
            attachedInstructionFiles: ["PERSONA.md"],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({
        prompts: {
          builtInInstructions: "channel instructions",
        },
      });
      expect(manager.getBuiltInInstructions()).toBe("channel instructions");
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "prompts.attachedInstructionFiles",
            scope: "global",
          }),
          expect.objectContaining({
            code: "unknown-key",
            path: "prompts.attachedInstructionFiles",
            scope: "channel",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores deprecated useGlobal and still layers channel over global", async () => {
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
        paths.channelSettingsPath,
        JSON.stringify({
          useGlobal: false,
          model: "channel-model",
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({
        model: "channel-model",
        judge: {
          enabled: true,
        },
      });
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "deprecated-key",
            path: "useGlobal",
            scope: "channel",
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
        paths.channelSettingsPath,
        JSON.stringify({ useGlobal: true, model: "channel-model" }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({ model: "channel-model" });
      expect("useGlobal" in manager.resolveSettings()).toBe(false);
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores malformed settings files", async () => {
    const paths = createTestPaths("athena-settings-malformed-");
    try {
      writeFileSync(paths.globalSettingsPath, "{invalid", "utf8");
      writeFileSync(paths.channelSettingsPath, "{broken", "utf8");

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
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
        paths.channelSettingsPath,
        JSON.stringify({ response: { maxSteps: 5 } }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
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
            scope: "channel",
            path: "response.maxSteps",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("rejects channel override keys after extraction", async () => {
    const paths = createTestPaths("athena-settings-reject-channel-overrides-");
    try {
      writeFileSync(
        paths.channelSettingsPath,
        JSON.stringify({
          workspace: {
            enableWorkspace: false,
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({});
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "workspace",
            scope: "channel",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores workspace plugin compatibility bridge keys in channel settings", async () => {
    const paths = createTestPaths("athena-settings-workspace-bridge-removed-");
    try {
      writeFileSync(
        paths.channelSettingsPath,
        JSON.stringify({
          workspace: {
            enableWorkspace: false,
            enableSandbox: true,
            externalPath: ["/tmp/external"],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({});
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "workspace",
            scope: "channel",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("surfaces workspace-bridge-like keys as unknown channel settings", async () => {
    const paths = createTestPaths("athena-settings-invalid-workspace-bridge-removed-");
    try {
      writeFileSync(
        paths.channelSettingsPath,
        JSON.stringify({
          workspace: {
            enableWorkspace: "nope",
            externalPath: ["/tmp/external", 123],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({});
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "workspace",
            scope: "channel",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });

  it("ignores legacy tools visibility settings and reports them as unknown keys", async () => {
    const paths = createTestPaths("athena-settings-tools-legacy-");
    try {
      writeFileSync(
        paths.globalSettingsPath,
        JSON.stringify({
          tools: {
            enabled: ["search_docs"],
            required: ["search_docs"],
          },
        }),
        "utf8",
      );

      const manager = new SettingsManager({
        globalSettingsPath: paths.globalSettingsPath,
        channelSettingsPath: paths.channelSettingsPath,
      });

      expect(manager.resolveSettings()).toEqual({});
      expect(manager.getReloadMetadata().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-key",
            path: "tools",
            scope: "global",
          }),
        ]),
      );
    } finally {
      await rm(paths.rootDir, { recursive: true, force: true });
    }
  });
});
