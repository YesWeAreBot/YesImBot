import type { AgentTool } from "@yesimbot/agent/agent";

import type { ExtensionBinding, ExtensionToolSnapshot } from "../../services/extension/types.js";

export function buildToolSnapshotFromBindings(
  bindings: readonly ExtensionBinding[],
): ExtensionToolSnapshot {
  const tools = new Map<string, AgentTool>();
  const activeToolNames: string[] = [];

  for (const binding of bindings) {
    for (const [name, tool] of binding.tools) {
      const {
        promptSnippet: _promptSnippet,
        promptGuidelines: _promptGuidelines,
        name: _name,
        ...agentTool
      } = tool;
      tools.set(name, agentTool as AgentTool);
      activeToolNames.push(name);
    }
  }

  return { tools, activeToolNames };
}
