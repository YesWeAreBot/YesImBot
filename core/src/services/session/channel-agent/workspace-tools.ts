import { join } from "node:path";

import type { ToolSet } from "ai";

import { LocalFilesystem, LocalSandbox, Workspace } from "../workspace";
import { createSendMessageTool } from "./send-message-tool";
import type { ChannelAgentOptions } from "./types";

type WorkspaceToolOptions = Pick<
  ChannelAgentOptions,
  "basePath" | "settingsManager"
>;

export async function buildResponseToolSet(options: {
  bot: NonNullable<ChannelAgentOptions["bot"]>;
  channelId: string;
  pluginTools: ToolSet;
  workspace: WorkspaceToolOptions;
}): Promise<ToolSet> {
  const sendMessageTool = createSendMessageTool({
    bot: options.bot,
    channelId: options.channelId,
  });

  if ("send_message" in options.pluginTools) {
    throw new Error("Tool name reserved: send_message");
  }

  const workspaceTools = await buildWorkspaceToolSet(options.workspace);
  if ("send_message" in workspaceTools) {
    throw new Error("Tool name reserved: send_message");
  }

  return {
    send_message: sendMessageTool,
    ...options.pluginTools,
    ...workspaceTools,
  };
}

async function buildWorkspaceToolSet(options: WorkspaceToolOptions): Promise<ToolSet> {
  const workspaceSettings = options.settingsManager.getWorkspaceSettings();
  const enableWorkspace = workspaceSettings?.enableWorkspace ?? true;
  if (!enableWorkspace) {
    return {};
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

  const workspace = new Workspace({
    filesystem,
    sandbox,
  });
  await workspace.init();
  return workspace.getAgentTools() as ToolSet;
}
