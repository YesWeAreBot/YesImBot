import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredToolDefinition } from "@yesimbot/plugin-sdk";
import type { ToolSet } from "ai";
import type { Logger } from "koishi";

import { LocalFilesystem } from "./filesystem";
import { LocalSandbox } from "./sandbox";
import type { WorkspacePluginConfig } from "./types";
import { Workspace } from "./workspace";

export interface WorkspaceToolOptions {
  channelDir: string;
  logger: Logger;
  config: WorkspacePluginConfig;
  createFilesystem?: (
    workspaceRoot: string,
    config: WorkspacePluginConfig,
  ) => LocalFilesystem | undefined;
  createSandbox?: (
    workspaceRoot: string,
    config: WorkspacePluginConfig,
  ) => LocalSandbox | undefined;
}

interface WorkspaceExecutionContext {
  workspaceRoot: string;
}

export async function buildWorkspacePluginToolDefinitions(
  options: WorkspaceToolOptions,
): Promise<RegisteredToolDefinition[]> {
  if (options.config.enableWorkspace === false) {
    return [];
  }

  const workspaceRoot = getWorkspaceRoot({
    channelDir: options.channelDir,
    config: options.config,
  });
  ensureWorkspaceRoot(workspaceRoot);
  const filesystem =
    options.config.enableFilesystem === false
      ? undefined
      : (options.createFilesystem?.(workspaceRoot, options.config) ??
        new LocalFilesystem({
          basePath: workspaceRoot,
          externalPath: options.config.externalPath,
        }));

  const sandbox = options.config.enableSandbox
    ? (options.createSandbox?.(workspaceRoot, options.config) ??
      new LocalSandbox({
        workingDirectory: workspaceRoot,
        env: process.env,
      }))
    : undefined;

  const workspace = new Workspace({ filesystem, sandbox });
  await workspace.init();

  const toolSet: ToolSet = {
    ...(workspace.getAgentTools() as ToolSet),
  };

  return toRegisteredToolDefinitions("workspace", toolSet, options.config, options);
}

function toRegisteredToolDefinitions(
  pluginName: string,
  toolSet: ToolSet,
  config: WorkspacePluginConfig,
  options: WorkspaceToolOptions,
): RegisteredToolDefinition[] {
  return Object.entries(toolSet).map(([name, tool]) => {
    const execute = createRuntimeAwareExecute(name, options, config);
    return {
      pluginName,
      name,
      definition: {
        name,
        description: tool.description ?? `${pluginName}:${name}`,
        inputSchema: tool.inputSchema,
        buildExtensionContext: (_hostInput, runtime) => ({
          workspaceRoot: getWorkspaceRoot({
            channelDir: options.channelDir,
            runtimeBasePath: runtime.basePath,
            config,
          }),
        }),
        isSupported: ({ runtime }) => {
          ensureWorkspaceRoot(
            getWorkspaceRoot({
              channelDir: options.channelDir,
              runtimeBasePath: runtime.basePath,
              config,
            }),
          );
          return true;
        },
        isAllowed: ({ enabledTools }: { enabledTools: string[] }) => enabledTools.includes(name),
        execute,
      },
      tool: {
        ...tool,
        execute,
      },
    };
  });
}

function getWorkspaceRoot(options: {
  channelDir: string;
  runtimeBasePath?: string;
  config: WorkspacePluginConfig;
}): string {
  const baseDir =
    options.config.mode === "global"
      ? options.channelDir
      : (options.runtimeBasePath ?? options.channelDir);
  return join(baseDir, "workspace");
}

function ensureWorkspaceRoot(workspaceRoot: string): void {
  mkdirSync(workspaceRoot, { recursive: true });
}

function workspaceRootFallback(
  options: WorkspaceToolOptions,
  config: WorkspacePluginConfig,
): string {
  return getWorkspaceRoot({
    channelDir: options.channelDir,
    config,
  });
}

function createRuntimeAwareExecute(
  name: string,
  options: WorkspaceToolOptions,
  config: WorkspacePluginConfig,
) {
  return async (
    input: unknown,
    executionOptions: Parameters<NonNullable<ToolSet[string]["execute"]>>[1],
  ) => {
    const context = executionOptions.experimental_context as
      | { workspace?: WorkspaceExecutionContext }
      | undefined;
    const currentWorkspaceRoot =
      context?.workspace?.workspaceRoot ?? workspaceRootFallback(options, config);
    const scopedTool = await createScopedTool(name, currentWorkspaceRoot, options, config);

    if (!scopedTool.execute) {
      throw new Error(`Tool is not executable: ${name}`);
    }

    return await scopedTool.execute(input, executionOptions);
  };
}

async function createScopedTool(
  name: string,
  workspaceRoot: string,
  options: WorkspaceToolOptions,
  config: WorkspacePluginConfig,
): Promise<ToolSet[string]> {
  ensureWorkspaceRoot(workspaceRoot);
  const filesystem =
    config.enableFilesystem === false
      ? undefined
      : (options.createFilesystem?.(workspaceRoot, config) ??
        new LocalFilesystem({
          basePath: workspaceRoot,
          externalPath: config.externalPath,
        }));

  const sandbox = config.enableSandbox
    ? (options.createSandbox?.(workspaceRoot, config) ??
      new LocalSandbox({
        workingDirectory: workspaceRoot,
        env: process.env,
      }))
    : undefined;

  const workspace = new Workspace({ filesystem, sandbox });
  await workspace.init();
  const toolSet: ToolSet = {
    ...(workspace.getAgentTools() as ToolSet),
  };

  const scopedTool = toolSet[name];
  if (!scopedTool) {
    throw new Error(`Tool not found in scoped workspace: ${name}`);
  }

  return scopedTool;
}
