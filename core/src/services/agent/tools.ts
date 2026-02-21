import { hasToolCall, jsonSchema, stepCountIs } from "ai";
import type { ToolSet } from "ai";

import type { PluginService } from "../plugin/service";
import { FunctionType, type ToolExecutionContext } from "../plugin/types";

export const finishTool = {
  description: "Signal that you have completed your response. Call this when done.",
  inputSchema: jsonSchema<{ summary?: string }>({
    type: "object",
    properties: { summary: { type: "string" } },
  }),
  execute: async ({ summary }: { summary?: string }) => ({ done: true, summary }),
} satisfies ToolSet[string];

export function buildAiSdkTools(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  maxResultLength: number,
): { tools: ToolSet; toolNames: Set<string> } {
  const tools: ToolSet = {};
  const toolNames = new Set<string>();
  for (const entry of pluginService.getTools(toolCtx)) {
    const name = entry.function.name;
    if (entry.functionType === FunctionType.Tool) toolNames.add(name);
    tools[name] = {
      description: entry.function.description,
      inputSchema: jsonSchema(entry.function.parameters),
      execute: async (params: Record<string, unknown>) => {
        const result = await pluginService.invoke(name, params, toolCtx);
        if (result.status === "failed") return { error: result.error };
        const str = JSON.stringify(result.content);
        if (str.length > maxResultLength) return str.slice(0, maxResultLength) + "[truncated]";
        return result.content;
      },
    };
  }
  tools["finish"] = finishTool;
  return { tools, toolNames };
}

export function buildStopCondition(maxRounds: number) {
  return [hasToolCall("finish"), stepCountIs(maxRounds)];
}
