import type { PluginService } from "../plugin/service";
import { FunctionType, type ToolExecutionContext } from "../plugin/types";

export function buildToolSchemaForPrompt(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
): string {
  const entries = pluginService.getTools(toolCtx);
  return entries
    .map((entry) => {
      const label = entry.functionType === FunctionType.Tool ? "tool" : "action";
      const params = JSON.stringify(entry.function.parameters);
      return `- ${entry.function.name} (${label}): ${entry.function.description}\n  Parameters: ${params}`;
    })
    .join("\n");
}
