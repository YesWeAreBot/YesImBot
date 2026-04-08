import { join } from "node:path";

import type { RegisteredToolDefinition } from "@yesimbot/plugin-sdk";
import type { ToolSet } from "ai";
import type { Logger } from "koishi";

import { DefaultSessionResourceLoader } from "../resource-loader";
import { LocalFilesystem, LocalSandbox, Workspace } from "../workspace";
import { createSendMessageTool } from "./send-message-tool";
import { buildToolAssembly } from "./tool-assembly";
import type { ChannelRuntimeOptions } from "./types";

type WorkspaceToolOptions = Pick<ChannelRuntimeOptions, "basePath" | "settingsManager"> & {
  logger: Logger;
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
] as const;

export async function buildResponseToolSet(options: {
  bot: NonNullable<ChannelRuntimeOptions["bot"]>;
  channelId: string;
  pluginTools: ToolSet;
  workspace: WorkspaceToolOptions;
}): Promise<ToolSet> {
  const assembly = buildToolAssembly({
    runtime: {
      channelKey: `runtime:${options.channelId}`,
      platform: "runtime",
      channelId: options.channelId,
      modelId: "runtime:unknown",
      basePath: options.workspace.basePath,
      turn: {
        messageId: "runtime-build-response-tool-set",
        timestamp: Date.now(),
        isDirect: false,
        atSelf: false,
        isReplyToBot: false,
      },
    },
    hostInput: undefined,
    pluginToolDefinitions: toRegisteredToolDefinitions("plugin", options.pluginTools),
    workspaceToolDefinitions: await buildWorkspaceToolDefinitions(options.workspace),
    toolSettings: {
      enabled: [
        ...Object.keys(options.pluginTools),
        ...(await listWorkspaceToolNames(options.workspace)),
      ],
    },
    sendMessageTool: createSendMessageTool({
      bot: options.bot,
      channelId: options.channelId,
    }),
  });

  return assembly.supportedTools;
}

export async function buildWorkspaceToolDefinitions(
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
    ? new LocalFilesystem({
        basePath: workspaceRoot,
        externalPath: workspaceSettings?.externalPath,
      })
    : undefined;

  const sandbox = enableSandbox
    ? new LocalSandbox({
        workingDirectory: workspaceRoot,
        env: process.env,
      })
    : undefined;

  const workspace = new Workspace({ filesystem, sandbox });
  await workspace.init();

  const resourceLoader = new DefaultSessionResourceLoader({
    channelDir: options.basePath,
    settingsManager: options.settingsManager,
    logger: options.logger,
  });

  const toolSet = {
    ...(resourceLoader.getSkillTools(filesystem) as ToolSet),
    ...(workspace.getAgentTools() as ToolSet),
  };

  return toRegisteredToolDefinitions("workspace", toolSet);
}

async function listWorkspaceToolNames(options: WorkspaceToolOptions): Promise<string[]> {
  const definitions = await buildWorkspaceToolDefinitions(options);
  return definitions.map((definition) => definition.name);
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
      isAllowed: ({ enabledTools }) => enabledTools.includes(name),
      execute: async (input, executionOptions) => {
        if (!tool.execute) {
          throw new Error(`Tool is not executable: ${name}`);
        }

        return await tool.execute(input, executionOptions);
      },
    },
    tool,
  }));
}
