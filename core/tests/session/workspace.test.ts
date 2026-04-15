import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context, Logger } from "koishi";
import WorkspacePlugin from "koishi-plugin-yesimbot-workspace";
import { describe, expect, it, vi } from "vitest";

import { LocalFilesystem } from "../../../plugins/workspace/src/filesystem";
import { LocalSandbox } from "../../../plugins/workspace/src/sandbox";
import { buildWorkspacePluginToolDefinitions } from "../../../plugins/workspace/src/tool-definitions";

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

async function assembleToolsWithLifecycle(options: {
  service: PluginService;
  runtime: ToolRuntime;
  scope: string;
  hostInput?: unknown;
}) {
  const sendMessageTool = createSendMessageTool({
    bot: {
      selfId: "bot-self",
      sendMessage: async () => undefined,
    } as never,
    channelId: options.runtime.channelId,
  });
  const catalog = await options.service.compileTools({
    runtime: options.runtime,
    scope: options.scope,
    sendMessageTool,
  });
  const responseContext = await options.service.buildResponseContext({
    runtime: options.runtime,
    hostInput: options.hostInput,
    scope: options.scope,
    catalog,
  });
  const selection = await options.service.selectTools({
    runtime: options.runtime,
    scope: options.scope,
    catalog,
    responseContext,
  });

  return {
    supportedTools: catalog.tools,
    activeTools: selection.activeTools,
    experimentalContext: selection.responseContext,
  };
}

async function installWorkspacePlugin(options: {
  basePath: string;
  scope?: string;
  config?: {
    enableWorkspace?: boolean;
    enableFilesystem?: boolean;
    enableSandbox?: boolean;
  };
}) {
  const ctx = createContextMock(options.basePath);
  const service = new PluginService(ctx);
  const config = {
    enableWorkspace: true,
    enableFilesystem: true,
    ...options.config,
  };

  const plugin = new WorkspacePlugin(ctx, {
    basePath: options.basePath,
    config,
    logger: ctx.logger("workspace"),
  });

  await plugin.init();
  await service.install(plugin, { scope: options.scope ?? "discord:channel-1" });

  return { ctx, service, plugin, config } as {
    ctx: Context;
    service: PluginService;
    plugin: WorkspacePlugin;
    config: typeof config;
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
      const assembly = await assembleToolsWithLifecycle({
        service,
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
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
        config: {
          enableWorkspace: true,
          enableFilesystem: true,
        },
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
      const assembly = await assembleToolsWithLifecycle({
        service,
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
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
        config: {
          enableWorkspace: true,
          enableFilesystem: true,
          enableSandbox: true,
        },
        logger: ctx.logger("workspace"),
        createSandbox: (workspaceRoot) => new LocalSandbox({ workingDirectory: workspaceRoot }),
      });

      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });
      const assembly = await assembleToolsWithLifecycle({
        service,
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
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

  it("does not expose skill tools when the skill plugin is absent", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-runtime-skills-disabled-"));
    try {
      const { service } = await installWorkspacePlugin({
        basePath,
        config: {
          enableWorkspace: true,
          enableFilesystem: true,
        },
      });
      const assembly = await assembleToolsWithLifecycle({
        service,
        runtime: createRuntime(basePath),
        hostInput: undefined,
        scope: "discord:channel-1",
      });

      expect(assembly.supportedTools).not.toHaveProperty("skill");
      expect(assembly.supportedTools).not.toHaveProperty("skill_read");
      expect(assembly.supportedTools).not.toHaveProperty("skill_search");
      expect(assembly.activeTools).not.toHaveProperty("skill");
      expect(assembly.activeTools).not.toHaveProperty("skill_read");
      expect(assembly.activeTools).not.toHaveProperty("skill_search");
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("defaults to scoped mode and can switch to global mode during tool execution", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-mode-"));
    const runtimeScopedPath = join(basePath, "channels", "discord-channel-1");
    const runtimeGlobalPath = join(basePath, "global-root");

    try {
      const ctx = createContextMock(basePath);
      const service = new PluginService(ctx);

      const scopedPlugin = new WorkspacePlugin(ctx, {
        basePath: runtimeGlobalPath,
        logger: ctx.logger("workspace"),
        enableWorkspace: true,
        enableFilesystem: true,
      });
      await scopedPlugin.init();
      await service.install(scopedPlugin, { scope: "discord:channel-1" });

      const scopedAssembly = await assembleToolsWithLifecycle({
        service,
        runtime: createRuntime(runtimeScopedPath),
        hostInput: undefined,
        scope: "discord:channel-1",
      });
      await scopedAssembly.activeTools.write_file.execute?.(
        { path: "scope.txt", content: "scoped" },
        {
          ...createToolOptions(),
          experimental_context: scopedAssembly.experimentalContext,
        },
      );

      expect(readFileSync(join(runtimeScopedPath, "workspace", "scope.txt"), "utf8")).toBe(
        "scoped",
      );
      expect(existsSync(join(runtimeGlobalPath, "workspace", "scope.txt"))).toBe(false);

      const globalDefinitions = await buildWorkspacePluginToolDefinitions({
        channelDir: runtimeGlobalPath,
        logger: createLoggerMock(),
        config: {
          mode: "global",
          enableWorkspace: true,
          enableFilesystem: true,
        },
      });
      const globalExecute = globalDefinitions.find((definition) => definition.name === "write_file")
        ?.tool.execute;
      await globalExecute?.(
        { path: "global.txt", content: "global" },
        {
          ...createToolOptions(),
          experimental_context: {
            workspace: {
              workspaceRoot: join(runtimeGlobalPath, "workspace"),
            },
          },
        },
      );

      expect(readFileSync(join(runtimeGlobalPath, "workspace", "global.txt"), "utf8")).toBe(
        "global",
      );
      expect(existsSync(join(runtimeScopedPath, "workspace", "global.txt"))).toBe(false);
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("uses namespaced response context when invoking workspace tools through PluginService", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "athena-workspace-invoke-context-"));
    const runtimeScopedPath = join(basePath, "channels", "discord-channel-1");
    const runtimeGlobalPath = join(basePath, "global-root");

    try {
      const ctx = createContextMock(basePath);
      const service = new PluginService(ctx);
      const plugin = new WorkspacePlugin(ctx, {
        basePath: runtimeGlobalPath,
        logger: ctx.logger("workspace"),
        enableWorkspace: true,
        enableFilesystem: true,
      });
      await plugin.init();
      await service.install(plugin, { scope: "discord:channel-1" });

      const runtime = createRuntime(runtimeScopedPath);
      await service.compileTools({
        runtime,
        scope: "discord:channel-1",
        sendMessageTool: createSendMessageTool({
          bot: {
            selfId: "bot-self",
            sendMessage: async () => undefined,
          } as never,
          channelId: runtime.channelId,
        }),
      });

      await service.invoke({
        name: "write_file",
        input: { path: "invoke.txt", content: "scoped" },
        runtime,
        hostInput: undefined,
        scope: "discord:channel-1",
      });

      expect(readFileSync(join(runtimeScopedPath, "workspace", "invoke.txt"), "utf8")).toBe(
        "scoped",
      );
      expect(existsSync(join(runtimeGlobalPath, "workspace", "invoke.txt"))).toBe(false);
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
