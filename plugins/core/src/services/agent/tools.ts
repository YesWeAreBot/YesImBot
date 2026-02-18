import { hasToolCall, jsonSchema, stepCountIs } from "ai";
import type { ToolSet } from "ai";

import type { PluginService } from "../plugin/service";
import type { FunctionContext } from "../plugin/types";

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
  fnCtx: FunctionContext,
  maxResultLength: number,
): ToolSet {
  const tools: ToolSet = { finish: finishTool };
  for (const entry of pluginService.getTools()) {
    const name = entry.function.name;
    tools[name] = {
      description: entry.function.description,
      inputSchema: jsonSchema(entry.function.parameters),
      execute: async (params: Record<string, unknown>) => {
        const result = await pluginService.invoke(name, params, fnCtx);
        if (result.status === "failed") return { error: result.error };
        const str = JSON.stringify(result.content);
        if (str.length > maxResultLength) return str.slice(0, maxResultLength) + "[truncated]";
        return result.content;
      },
    };
  }
  return tools;
}

export function buildStopCondition(maxRounds: number) {
  return [hasToolCall("finish"), stepCountIs(maxRounds)];
}
