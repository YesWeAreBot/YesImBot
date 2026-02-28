import { FunctionType, ToolExecutionContext } from "@yesimbot/plugin";

import type { PluginService } from "../plugin/service";
import type { ToolFilter } from "../skill/types";

export function buildToolSchemaForPrompt(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: ToolFilter,
): string {
  let entries = pluginService.getTools(toolCtx);
  if (toolFilter?.include?.length) {
    // Fetch hidden tools that are explicitly included by skill
    const all = pluginService.getTools(toolCtx, true);
    const hidden = all.filter(
      (e) =>
        !entries.some((v) => v.function.name === e.function.name) &&
        toolFilter.include!.includes(e.function.name),
    );
    entries = entries.concat(hidden);
  }
  if (toolFilter?.exclude?.length) {
    entries = entries.filter((e) => !toolFilter.exclude!.includes(e.function.name));
  }
  const lines = entries.map((entry) => {
    const label = entry.functionType === FunctionType.Tool ? "tool" : "action";
    const params = JSON.stringify(entry.function.parameters);
    return `- ${entry.function.name} (${label}): ${entry.function.description}\n  Parameters: ${params}`;
  });
  // Warn about skill-requested tools that don't exist
  if (toolFilter?.include?.length) {
    const available = new Set(entries.map((e) => e.function.name));
    for (const name of toolFilter.include) {
      if (!available.has(name)) {
        lines.push(`- ${name}: [unavailable — tool not installed]`);
      }
    }
  }
  return lines.join("\n");
}
