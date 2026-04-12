import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context, Logger } from "koishi";
import { describe, expect, it, vi } from "vitest";

import WorkspacePlugin, {
  LocalFilesystem,
  LocalSandbox,
} from "koishi-plugin-yesimbot-workspace";

vi.mock("koishi", () => {
  const createChain = () => ({
    default: () => createChain(),
    required: () => createChain(),
    role: () => createChain(),
    description: () => createChain(),
  });

  class Service<TConfig = unknown> {
    protected ctx: unknown;
    protected config!: TConfig;
    protected logger: Logger;

    constructor(ctx: Context, name: string) {
      this.ctx = ctx;
      this.logger = ctx.logger(name);
    }
  }

  return {
    Context: class {},
    Schema: {
      object: () => createChain(),
      const: () => createChain(),
      boolean: () => createChain(),
      string: () => createChain(),
      path: () => createChain(),
      array: () => createChain(),
      union: () => createChain(),
    },
    Service,
  };
});

import { PluginService } from "../../src/services/plugin/service";
import { createSendMessageTool } from "../../src/services/session/runtime/send-message-tool";
import { SettingsManager } from "../../src/services/session/settings-manager";
import type { ToolRuntime } from "../../src/services/session/types";

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createContextMock(baseDir: string): Context {
  return {
    baseDir,
    logger: vi.fn(() => createLoggerMock()),
    on: vi.fn(),
  } as unknown as Context;
}

function createToolOptions() {
  return {
    toolCallId: "test-call-id",
    messages: [],
  };
}

interface WorkspaceManagerPaths {
  basePath: string;
  globalSettingsPath: string;
  workspaceSettingsPath: string;
}

function createWorkspaceManagerPaths(basePath: string): WorkspaceManagerPaths {
  return {
    basePath,
    globalSettingsPath: join(basePath, "settings.json"),
    workspaceSettingsPath: join(basePath, "workspace.settings.json"),
  };
}

function createWorkspaceSettingsManager(basePath: string, workspaceSettings: Record<string, unknown>) {
  const paths = createWorkspaceManagerPaths(basePath);
  writeFileSync(paths.workspaceSettingsPath, JSON.stringify({ workspace: workspaceSettings }), "utf8");
  return new SettingsManager({
    globalSettingsPath: paths.globalSettingsPath,
    workspaceSettingsPath: paths.workspaceSettingsPath,
  });
}

function createRuntime(basePath: string, scope = "discord:channel-1"): ToolRuntime {
  return {
    channelKey: scope,
    platform: "discord",
    channelId: "channel-1",
    modelId: "test:model",
    basePath,
    turn: {
      messageId: "msg-1",
      timestamp: Date.now(),
      isDirect: true,
      atSelf: true,
      isReplyToBot: false,
    },
  };
}

async function installWorkspacePlugin(options: {
  basePath: string;
  scope?: string;
  workspaceSettings?: {
    enableWorkspace?: boolean;
    enableFilesystem?: boolean;
    enableSandbox?: boolean;
    skills?: string[];
  };
}) {
  const ctx = createContextMock(options.basePath);
  const service = new PluginService(ctx);
  const settingsManager = createWorkspaceSettingsManager(options.basePath, {
    enableWorkspace: true,
    enableFilesystem: true,
    ...options.workspaceSettings,
  });

  const plugin = new WorkspacePlugin(ctx, {
    basePath: options.basePath,
    settingsManager,
    logger: ctx.logger("workspace"),
  });

  await plugin.init();
  await service.install(plugin, { scope: options.scope ?? "discord:channel-1" });

  return { ctx, service, plugin, settingsManager } as {
    ctx: Context;
    service: PluginService;
    plugin: WorkspacePlugin;
    settingsManager: typeof settingsManager;
  };
}

describe("workspace", () => {
  it("loads workspace tools from the extracted plugin package", async () => {
    const module = await import("koishi-plugin-yesimbot-workspace");

    expect(module.default).toBeDefined();
  });

  it("exposes filesystem tools by default and hides sandbox/skill tools through assembled scoped tools", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-fs-"));
    try {
      const { service } = await installWorkspacePlugin({ basePath });
      const assembly = await service.assembleTools({
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
        toolSettings: {
          enabled: ["read_file", "write_file", "edit_file", "list_files", "delete", "file_stat", "mkdir", "grep"],
        },
        sendMessageTool: createSendMessageTool({
          bot: {
            selfId: "bot-self",
            sendMessage: async () => undefined,
          } as never,
          channelId: "channel-1",
        }),
      });

      expect(assembly.supportedTools).toHaveProperty("read_file");
      expect(assembly.supportedTools).toHaveProperty("write_file");
      expect(assembly.supportedTools).toHaveProperty("edit_file");
      expect(assembly.supportedTools).toHaveProperty("list_files");
      expect(assembly.supportedTools).toHaveProperty("delete");
      expect(assembly.supportedTools).toHaveProperty("file_stat");
      expect(assembly.supportedTools).toHaveProperty("mkdir");
      expect(assembly.supportedTools).toHaveProperty("grep");
      expect(assembly.supportedTools).not.toHaveProperty("execute_command");
      expect(assembly.supportedTools).not.toHaveProperty("skill");
      expect(assembly.supportedTools).not.toHaveProperty("skill_read");
      expect(assembly.supportedTools).not.toHaveProperty("skill_search");
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("hides write tools when filesystem is read-only through assembled scoped tools", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-ro-"));
    try {
      const ctx = createContextMock(basePath);
      const service = new PluginService(ctx);
      const plugin = new WorkspacePlugin(ctx, {
        basePath,
        settingsManager: createWorkspaceSettingsManager(basePath, {
          enableWorkspace: true,
          enableFilesystem: true,
        }),
        logger: ctx.logger("workspace"),
        createFilesystem: (workspaceRoot, workspaceSettings) =>
          new LocalFilesystem({
            basePath: workspaceRoot,
            externalPath: workspaceSettings?.externalPath,
            readOnly: true,
          }),
      });

      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });
      const assembly = await service.assembleTools({
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
        toolSettings: {
          enabled: ["read_file", "list_files", "file_stat", "grep"],
        },
      });

      expect(assembly.supportedTools).toHaveProperty("read_file");
      expect(assembly.supportedTools).toHaveProperty("list_files");
      expect(assembly.supportedTools).toHaveProperty("file_stat");
      expect(assembly.supportedTools).toHaveProperty("grep");
      expect(assembly.supportedTools).not.toHaveProperty("write_file");
      expect(assembly.supportedTools).not.toHaveProperty("edit_file");
      expect(assembly.supportedTools).not.toHaveProperty("delete");
      expect(assembly.supportedTools).not.toHaveProperty("mkdir");
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("exposes execute command only when sandbox is configured through assembled scoped tools", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-sandbox-"));
    try {
      const ctx = createContextMock(basePath);
      const service = new PluginService(ctx);
      const plugin = new WorkspacePlugin(ctx, {
        basePath,
        settingsManager: createWorkspaceSettingsManager(basePath, {
          enableWorkspace: true,
          enableFilesystem: true,
          enableSandbox: true,
        }),
        logger: ctx.logger("workspace"),
        createSandbox: (workspaceRoot) => new LocalSandbox({ workingDirectory: workspaceRoot }),
      });

      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });
      const assembly = await service.assembleTools({
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
        toolSettings: {
          enabled: ["execute_command"],
        },
      });

      expect(assembly.supportedTools).toHaveProperty("execute_command");

      const execute = assembly.activeTools.execute_command.execute;
      const result = await execute?.(
        {
          command: "printf ok",
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

  it("keeps skill tools available from the canonical scoped plugin seam", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-runtime-skills-"));
    try {
      const workspaceDir = join(basePath, "workspace");
      const skillsRoot = join(workspaceDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      const skillFile = join(skillRoot, "SKILL.md");
      const referenceFile = join(skillRoot, "references", "guide.md");
      mkdirSync(join(skillRoot, "references"), { recursive: true });
      writeFileSync(skillFile, "# Code Review\nAlways review carefully.", { encoding: "utf8" });
      writeFileSync(referenceFile, "Use references for checks.", { encoding: "utf8" });

      const { service } = await installWorkspacePlugin({
        basePath,
        workspaceSettings: {
          enableWorkspace: true,
          enableFilesystem: true,
          skills: ["/skills"],
        },
      });
      const assembly = await service.assembleTools({
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
        toolSettings: {
          enabled: ["skill", "skill_read", "skill_search"],
        },
      });

      expect(assembly.supportedTools).toHaveProperty("skill");
      expect(assembly.supportedTools).toHaveProperty("skill_read");
      expect(assembly.supportedTools).toHaveProperty("skill_search");

      const skillResult = await assembly.activeTools.skill.execute?.({ name: "code-review" }, createToolOptions());
      expect(skillResult).toMatchObject({
        name: "code-review",
      });

      const readResult = await assembly.activeTools.skill_read.execute?.(
        { name: "code-review", path: "references/guide.md" },
        createToolOptions(),
      );
      expect(readResult).toMatchObject({
        content: "Use references for checks.",
      });

      const searchResult = await assembly.activeTools.skill_search.execute?.(
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

  it("bridges raw workspace settings from SettingsManager into the scoped workspace plugin seam", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-bridge-runtime-"));
    try {
      const workspaceDir = join(basePath, "workspace");
      const skillsRoot = join(workspaceDir, "skills");
      const skillRoot = join(skillsRoot, "code-review");
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(join(basePath, "workspace.settings.json"), JSON.stringify({
        workspace: {
          enableWorkspace: true,
          enableFilesystem: true,
          skills: ["/skills"],
        },
      }), "utf8");
      writeFileSync(join(skillRoot, "SKILL.md"), "# Code Review\nBridge works.", "utf8");

      const ctx = createContextMock(basePath);
      const service = new PluginService(ctx);
      const settingsManager = new SettingsManager({
        globalSettingsPath: join(basePath, "settings.json"),
        workspaceSettingsPath: join(basePath, "workspace.settings.json"),
      });
      const plugin = new WorkspacePlugin(ctx, {
        basePath,
        settingsManager,
        logger: ctx.logger("workspace"),
      });

      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });
      const assembly = await service.assembleTools({
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
        toolSettings: {
          enabled: ["skill"],
        },
      });

      expect(settingsManager.resolveSettings()).toEqual({});
      expect(assembly.supportedTools).toHaveProperty("skill");
      const skillResult = await assembly.activeTools.skill.execute?.(
        { name: "code-review" },
        createToolOptions(),
      );
      expect(skillResult).toMatchObject({
        name: "code-review",
      });
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
