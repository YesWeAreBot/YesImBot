import type { WorkspaceToolSet } from "../types";
import type { Workspace } from "../workspace";
import { createDeleteTool } from "./delete";
import { createEditFileTool } from "./edit-file";
import { createExecuteCommandTool } from "./execute-command";
import { createFileStatTool } from "./file-stat";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createListFilesTool } from "./list-files";
import { createMkdirTool } from "./mkdir";
import { createReadFileTool } from "./read-file";
import { createWriteFileTool } from "./write-file";

export { createReadFileTool } from "./read-file";
export { createWriteFileTool } from "./write-file";
export { createEditFileTool } from "./edit-file";
export { createListFilesTool } from "./list-files";
export { createDeleteTool } from "./delete";
export { createMkdirTool } from "./mkdir";
export { createFileStatTool } from "./file-stat";
export { createGrepTool } from "./grep";
export { createGlobTool } from "./glob";
export { createExecuteCommandTool } from "./execute-command";

export function createWorkspaceTools(workspace: Workspace): WorkspaceToolSet {
  return [
    createReadFileTool(workspace),
    createWriteFileTool(workspace),
    createEditFileTool(workspace),
    createListFilesTool(workspace),
    createDeleteTool(workspace),
    createMkdirTool(workspace),
    createFileStatTool(workspace),
    createGrepTool(workspace),
    createGlobTool(workspace),
    createExecuteCommandTool(workspace),
  ];
}
