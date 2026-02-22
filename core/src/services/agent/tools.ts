import type { PluginService } from "../plugin/service";
import { FunctionType, type ToolExecutionContext } from "../plugin/types";
import type { ToolFilter } from "../skill/types";

export function buildToolSchemaForPrompt(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  toolFilter?: ToolFilter,
): string {
  let entries = pluginService.getTools(toolCtx);
  if (toolFilter) {
    if (toolFilter.include?.length) {
      entries = entries.filter((e) => toolFilter.include!.includes(e.function.name));
    }
    if (toolFilter.exclude?.length) {
      entries = entries.filter((e) => !toolFilter.exclude!.includes(e.function.name));
    }
  }
  return entries
    .map((entry) => {
      const label = entry.functionType === FunctionType.Tool ? "tool" : "action";
      const params = JSON.stringify(entry.function.parameters);
      return `- ${entry.function.name} (${label}): ${entry.function.description}\n  Parameters: ${params}`;
    })
    .join("\n");
}
