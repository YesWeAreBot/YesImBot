import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import {
  createDeleteNoteTool,
  createListNotesTool,
  createReadAllNotesTool,
  createReadNoteTool,
  createWriteNoteTool,
} from "./notes-tool";
import { createGetChannelInfoTool, createGetGroupMembersTool } from "./query-tools";
import type { AthenaToolDefinition, ChannelContext } from "./tool-types";

/**
 * Create the customTools array for a specific channel session (per D-19, D-22).
 * Tools capture channel context via closure (per D-20).
 * Returns both the ToolDefinition[] for createAgentSession and Athena metadata.
 */
export function createChannelTools(channelCtx: ChannelContext): {
  customTools: ToolDefinition[];
  athenaTools: AthenaToolDefinition[];
} {
  const athenaTools = [
    createListNotesTool(channelCtx),
    createReadNoteTool(channelCtx),
    createWriteNoteTool(channelCtx),
    createDeleteNoteTool(channelCtx),
    createReadAllNotesTool(channelCtx),
    createGetGroupMembersTool(channelCtx),
    createGetChannelInfoTool(channelCtx),
  ];

  return {
    customTools: athenaTools.map((tool) => tool.definition),
    athenaTools,
  };
}
