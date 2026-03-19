import type { PluginService } from "../plugin/service";
import { FunctionType, ToolExecutionContext } from "../plugin/types";
import type { PromptFragment } from "../prompt/types";

const TOOL_PROTOCOL_CONTENT = [
  "## Tool Protocol",
  "",
  "Tools retrieve information or compute results. Actions produce side effects.",
  "",
  "Use tools only when they directly improve accuracy or actionability.",
  "Prefer minimal, deterministic parameters and avoid speculative tool calls.",
  "",
  "If no tool or action is needed, answer directly without calling tools.",
].join("\n");

function buildToolAvailability(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  allowedTools?: string[],
): string {
  const decision = pluginService.getRoundAvailability(toolCtx, allowedTools);
  const visibleEntries = decision.visible;
  const unavailableHints = decision.unavailable.map(
    (entry) => `- ${entry.name}: [unavailable — ${entry.detail}]`,
  );

  const lines = visibleEntries.map((entry) => {
    const label = entry.functionType === FunctionType.Tool ? "tool" : "action";
    const params = JSON.stringify(entry.function.parameters);
    return `- ${entry.function.name} (${label}): ${entry.function.description}\n  Parameters: ${params}`;
  });
  lines.push(...unavailableHints);

  return lines.join("\n");
}

export function buildToolPromptFragments(
  pluginService: PluginService,
  toolCtx: ToolExecutionContext,
  allowedTools?: string[],
): PromptFragment[] {
  const availability = buildToolAvailability(pluginService, toolCtx, allowedTools);
  const availableContent = availability
    ? `<tools>\nTools/actions available this round:\n${availability}\n</tools>`
    : "<tools>\nNo tools/actions are available this round.\n</tools>";

  return [
    {
      id: "tooling.protocol",
      content: TOOL_PROTOCOL_CONTENT,
      section: "policy",
      source: "tooling",
      priority: 500,
      stability: "stable",
      cacheable: true,
    },
    {
      id: "tooling.available",
      content: availableContent,
      section: "situation",
      source: "tooling",
      priority: 520,
      stability: "dynamic",
      cacheable: false,
    },
  ];
}
