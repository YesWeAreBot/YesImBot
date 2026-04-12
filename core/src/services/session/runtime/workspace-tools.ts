import { join } from "node:path";

import type { RegisteredToolDefinition } from "@yesimbot/plugin-sdk";
import type { ToolSet } from "ai";
import type { Logger } from "koishi";

import { DefaultSessionResourceLoader } from "../resource-loader";
import { LocalFilesystem, LocalSandbox, Workspace } from "../workspace";
import type { AthenaSessionSettings } from "../settings-manager";
import type { ChannelRuntimeOptions } from "./types";

type WorkspaceToolOptions = Pick<ChannelRuntimeOptions, "basePath" | "settingsManager"> & {
  logger: Logger;
  createFilesystem?: (
    workspaceRoot: string,
    workspaceSettings: AthenaSessionSettings["workspace"],
  ) => LocalFilesystem | undefined;
  createSandbox?: (
    workspaceRoot: string,
    workspaceSettings: AthenaSessionSettings["workspace"],
  ) => LocalSandbox | undefined;
};

export const WORKSPACE_TOOL_NAMES = [
  "read_file",
  "list_files",
  "file_stat",
  "grep",
  "write_file",
  "edit_file",
  "delete",
  "mkdir",
  "execute_command",
  "skill",
  "skill_read",
  "skill_search",
] as const;

export async function buildWorkspacePluginToolDefinitions(
  options: WorkspaceToolOptions,
): Promise<RegisteredToolDefinition[]> {
  const workspaceSettings = options.settingsManager.getWorkspaceSettings();
  const enableWorkspace = workspaceSettings?.enableWorkspace ?? true;
  if (!enableWorkspace) {
    return [];
  }

  const workspaceRoot = join(options.basePath, "workspace");
  const enableFilesystem = workspaceSettings?.enableFilesystem ?? true;
  const enableSandbox = workspaceSettings?.enableSandbox ?? false;

  const filesystem = enableFilesystem
    ? (options.createFilesystem?.(workspaceRoot, workspaceSettings) ??
      new LocalFilesystem({
        basePath: workspaceRoot,
        externalPath: workspaceSettings?.externalPath,
      }))
    : undefined;

  const sandbox = enableSandbox
    ? (options.createSandbox?.(workspaceRoot, workspaceSettings) ??
      new LocalSandbox({
        workingDirectory: workspaceRoot,
        env: process.env,
      }))
    : undefined;

  const workspace = new Workspace({ filesystem, sandbox });
  await workspace.init();

  const resourceLoader = new DefaultSessionResourceLoader({
    channelDir: options.basePath,
    settingsManager: options.settingsManager,
    logger: options.logger,
  });

  const toolSet: ToolSet = {
    ...(workspace.getAgentTools() as ToolSet),
    ...(resourceLoader.getSkillTools(filesystem) as ToolSet),
  };

  return toRegisteredToolDefinitions("workspace", toolSet);
}

function toRegisteredToolDefinitions(
  pluginName: string,
  toolSet: ToolSet,
): RegisteredToolDefinition[] {
  return Object.entries(toolSet).map(([name, tool]) => ({
    pluginName,
    name,
    definition: {
      name,
      description: tool.description ?? `${pluginName}:${name}`,
      inputSchema: tool.inputSchema,
      isSupported: () => true,
      isAllowed: ({ enabledTools }: { enabledTools: string[] }) => enabledTools.includes(name),
      execute: async (input: unknown, executionOptions: Parameters<NonNullable<typeof tool.execute>>[1]) => {
        if (!tool.execute) {
          throw new Error(`Tool is not executable: ${name}`);
        }

        return await tool.execute(input, executionOptions);
      },
    },
    tool,
  }));
}
