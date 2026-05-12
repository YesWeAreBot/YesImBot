import type { WorkspaceToolSet } from "../types";
import type { Workspace } from "../workspace";
import { createEditFileTool } from "./edit-file";
import { createExecuteCommandTool } from "./execute-command";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createReadFileTool } from "./read-file";
import { createWriteFileTool } from "./write-file";

export { createReadFileTool } from "./read-file";
export { createWriteFileTool } from "./write-file";
export { createEditFileTool } from "./edit-file";
export { createGrepTool } from "./grep";
export { createGlobTool } from "./glob";
export { createExecuteCommandTool } from "./execute-command";

export function createWorkspaceTools(workspace: Workspace): WorkspaceToolSet {
  return [
    createReadFileTool(workspace),
    createWriteFileTool(workspace),
    createEditFileTool(workspace),
    createGrepTool(workspace),
    createGlobTool(workspace),
    createExecuteCommandTool(workspace),
  ];
}
